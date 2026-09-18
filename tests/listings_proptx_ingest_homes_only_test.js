// PropTx ingest homes-only test (2026-09-18).
//
// The first real Mississauga page saved a Parking Space ($47,800) because
// PropTx files it as Residential + For Sale. ingestCityPage now checks
// every listing against home-types.js before saving. This proves, with a
// fake PropTx page built from real labels:
//   1. Non-homes (Parking Space, Locker, Vacant Land, an unknown label)
//      are never written to D1.
//   2. Real homes, including "Semi-Detached " with its trailing space, ARE
//      written, and property_subtype is stored exactly as PropTx sent it
//      (trailing space kept -- Article 6.3(f), content not altered).
//   3. The result reports what was skipped and why, by label.
//
// Run: node --no-warnings tests/listings_proptx_ingest_homes_only_test.js

const path = require("path");
const { pathToFileURL } = require("url");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

const PAGE = [
  { ListingKey: "H1", PropertySubType: "Detached" },
  { ListingKey: "H2", PropertySubType: "Semi-Detached " },
  { ListingKey: "H3", PropertySubType: "Condo Apartment" },
  { ListingKey: "H4", PropertySubType: "Duplex" },
  { ListingKey: "N1", PropertySubType: "Parking Space" },
  { ListingKey: "N2", PropertySubType: "Locker" },
  { ListingKey: "N3", PropertySubType: "Vacant Land" },
  { ListingKey: "N4", PropertySubType: "Some Future Label" },
  { ListingKey: "N5" }, // no subtype at all
].map((p) => ({ ListPrice: 500000, City: "Mississauga", StandardStatus: "Active", TransactionType: "For Sale", Media: [], ...p }));

(async () => {
  const ingest = await import(pathToFileURL(path.join(SRC_DIR, "proptx-ingest.js")).href);

  const written = [];
  const db = {
    prepare(sql) { return { bind(...args) { return { sql, args }; } }; },
    async batch(stmts) {
      for (const s of stmts) {
        const cols = s.sql.match(/INSERT INTO listings \(([^)]*)\)/)[1].split(",").map((c) => c.trim());
        written.push(Object.fromEntries(cols.map((c, i) => [c, s.args[i]])));
      }
      return stmts.map(() => ({ success: true }));
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ value: PAGE }), { status: 200, headers: { "Content-Type": "application/json" } });
  let res;
  try {
    res = await ingest.ingestCityPage(db, "tok", "Mississauga", null);
  } finally {
    globalThis.fetch = realFetch;
  }

  const keys = written.map((r) => r.listing_key).sort();
  check("only the 4 real homes are written", JSON.stringify(keys) === JSON.stringify(["H1", "H2", "H3", "H4"]), JSON.stringify(keys));
  check("no non-home is written", !written.some((r) => r.listing_key.startsWith("N")));
  const semi = written.find((r) => r.listing_key === "H2");
  check("trailing-space semi is saved with its subtype exactly as sent", semi && semi.property_subtype === "Semi-Detached ", JSON.stringify(semi && semi.property_subtype));
  check("fetched count still reports the full page (9)", res.fetchedThisPage === 9, `${res.fetchedThisPage}`);
  check("upserted count is 4", res.upsertedThisPage === 4, `${res.upsertedThisPage}`);
  check("skipped count is 5", res.skippedNotAHomeCount === 5, `${res.skippedNotAHomeCount}`);
  check("skips are reported by label",
    res.skippedNotAHome["Parking Space"] === 1 && res.skippedNotAHome["Locker"] === 1 &&
    res.skippedNotAHome["Vacant Land"] === 1 && res.skippedNotAHome["Some Future Label"] === 1 &&
    res.skippedNotAHome["(blank)"] === 1, JSON.stringify(res.skippedNotAHome));

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
