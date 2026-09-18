// PropTx subtype census test (2026-09-18).
//
// proptx-census.js and the /proptx-subtype-census route are temporary and
// read-only. This proves, against a fake PropTx that answers from a known
// in-memory dataset:
//   1. Every request stays inside the ingest's own scope (Active, For Sale,
//      Residential) -- the census can't report on listings ingest would
//      never let in.
//   2. Count requests are $top=0 (no listing content pulled for counts).
//   3. The gap math is right: known labels are counted, an unknown label
//      ("Mystery Type") shows up as a gap AND by name in the sample.
//   4. With no unknown labels, gap is 0, listIsComplete is true, and no
//      sample request is made.
//   5. The route never touches D1.
//
// Run: node --no-warnings tests/listings_proptx_subtype_census_test.js

const path = require("path");
const { pathToFileURL } = require("url");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

// Fake PropTx: understands exactly the filter shapes the census sends.
function makeFakePropTx(dataset, log) {
  return async (url) => {
    log.push(url);
    const u = new URL(url);
    const filter = u.searchParams.get("$filter") || "";
    const inScope = dataset.filter((r) => r.active && r.forSale && r.residential);
    let rows = inScope;
    const eq = filter.match(/PropertySubType eq '((?:[^']|'')*)'$/);
    if (eq) rows = inScope.filter((r) => r.sub === eq[1].replace(/''/g, "'"));
    const nes = [...filter.matchAll(/PropertySubType ne '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    if (nes.length) rows = inScope.filter((r) => !nes.includes(r.sub));
    const body = u.searchParams.get("$count") === "true"
      ? { "@odata.count": rows.length, value: [] }
      : { value: rows.slice(0, Number(u.searchParams.get("$top") || 100)).map((r) => ({ ListingKey: r.key, PropertySubType: r.sub, City: "X", PropertyType: "Residential Freehold", ListPrice: 1 })) };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

function row(key, sub, extra = {}) {
  return { key, sub, active: true, forSale: true, residential: true, ...extra };
}

(async () => {
  const census = await import(pathToFileURL(path.join(SRC_DIR, "proptx-census.js")).href);

  // --- Case A: one unknown label present ---
  const datasetA = [
    row("A1", "Detached"), row("A2", "Detached"), row("A3", "Condo Apartment"),
    row("A4", "Parking Space"), row("A5", "Mystery Type"), row("A6", "Mystery Type"),
    row("X1", "Detached", { forSale: false }),      // lease -- out of scope
    row("X2", "Detached", { residential: false }),  // commercial -- out of scope
  ];
  const logA = [];
  const resA = await census.runSubtypeCensus("tok", makeFakePropTx(datasetA, logA));

  check("every request carries the ingest scope (Active + For Sale + Residential)",
    logA.every((url) => {
      const f = new URL(url).searchParams.get("$filter");
      return f.startsWith(census.CENSUS_BASE_FILTER);
    }));
  check("scope string matches the ingest filter's own conditions",
    census.CENSUS_BASE_FILTER.includes("StandardStatus eq 'Active'") &&
    census.CENSUS_BASE_FILTER.includes("TransactionType eq 'For Sale'") &&
    census.CENSUS_BASE_FILTER.includes("startswith(PropertyType,'Residential')"));
  check("all count requests use $top=0",
    logA.filter((u) => new URL(u).searchParams.get("$count") === "true")
      .every((u) => new URL(u).searchParams.get("$top") === "0"));
  check("total counts only in-scope listings (6, not 8)", resA.totalActiveResidentialForSale === 6, `got ${resA.totalActiveResidentialForSale}`);
  check("known labels cover 4", resA.coveredByKnownLabels === 4, `got ${resA.coveredByKnownLabels}`);
  check("gap is 2", resA.gap === 2, `got ${resA.gap}`);
  check("listIsComplete is false when a gap exists", resA.listIsComplete === false);
  check("unknown label appears by name in the sample", resA.uncoveredLabelsInSample["Mystery Type"] === 2, JSON.stringify(resA.uncoveredLabelsInSample));
  check("Detached counted correctly",
    (resA.countsByLabel.find((c) => c.subtype === "Detached") || {}).count === 2);
  check("labels with zero listings are listed separately, not mixed into counts",
    resA.countsByLabel.every((c) => c.count > 0) && resA.knownLabelsWithZeroListings.includes("Locker"));

  // --- Case B: every label known ---
  const datasetB = [row("B1", "Detached"), row("B2", "Semi-Detached"), row("B3", "Condo Townhouse")];
  const logB = [];
  const resB = await census.runSubtypeCensus("tok", makeFakePropTx(datasetB, logB));
  check("gap is 0 when every label is known", resB.gap === 0, `got ${resB.gap}`);
  check("listIsComplete is true when gap is 0", resB.listIsComplete === true);
  check("no sample request is made when gap is 0",
    logB.every((u) => new URL(u).searchParams.get("$count") === "true"));

  // --- Route: wired, and never touches D1 ---
  const worker = (await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href)).default;
  const dbCalls = [];
  const env = { PROPTX_IDX_TOKEN: "tok", DB: { prepare(sql) { dbCalls.push(sql); throw new Error("census must not touch D1"); } } };
  const realFetch = globalThis.fetch;
  const routeLog = [];
  globalThis.fetch = makeFakePropTx(datasetB, routeLog);
  try {
    const resp = await worker.fetch(new Request("https://w.example/proptx-subtype-census"), env);
    const body = await resp.json();
    check("route responds 200 with census JSON", resp.status === 200 && body.listIsComplete === true, JSON.stringify(body).slice(0, 200));
    check("route sends the Worker's PropTx token", routeLog.length > 0);
    check("route makes zero D1 calls", dbCalls.length === 0, `${dbCalls.length} calls`);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
