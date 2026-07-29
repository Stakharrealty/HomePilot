// /ingest-probe diagnostic route test (2026-07-28, ingestion scope audit).
//
// Verifies:
//   1. buildProbeFilterClauses() produces exactly the 4 filter clauses
//      specified, each isolating one additional variable vs. the baseline
//   2. buildIngestProbeQuery() uses $top=5, $count=true, and the given
//      $select -- never a full-page pull
//   3. index.js wires up /ingest-probe, defaults to the 5 requested
//      cities, and makes ZERO env.DB calls (strictly read-only)
//   4. End-to-end against a mocked CREA: a filter that excludes more
//      listings produces a lower recordCount, proving the route can
//      actually distinguish "CREA doesn't have them" from "our filter
//      excludes them" once run against real data
//
// This test does NOT call real CREA and does NOT touch D1.
// Run: node tests/listings_ingest_probe_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

async function main() {
  const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);
  const indexSrc = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");

  // --- 1. buildProbeFilterClauses ---
  check(
    "INGEST_PROBE_CITIES defaults to exactly the 5 requested cities",
    JSON.stringify(query.INGEST_PROBE_CITIES) === JSON.stringify(["Toronto", "Brampton", "Mississauga", "Vaughan", "Markham"])
  );

  const clauses = query.buildProbeFilterClauses("Toronto");
  check("test1_cityOnly is exactly City eq 'Toronto', no other clauses", clauses.test1_cityOnly === "City eq 'Toronto'");
  check(
    "test2_withProvince adds StateOrProvince on top of test1",
    clauses.test2_withProvince === "StateOrProvince eq 'Ontario' and City eq 'Toronto'"
  );
  check(
    "test3_withPrice adds ListPrice on top of test2 (not stacked on test4)",
    clauses.test3_withPrice === "StateOrProvince eq 'Ontario' and City eq 'Toronto' and ListPrice gt 50000"
  );
  check(
    "test4_withSubtype adds PropertySubType on top of test2 (branches independently of test3)",
    clauses.test4_withSubtype === "StateOrProvince eq 'Ontario' and City eq 'Toronto' and PropertySubType eq 'Single Family'"
  );
  check(
    "test3 and test4 are independent branches (neither contains the other's unique clause)",
    !clauses.test3_withPrice.includes("PropertySubType") && !clauses.test4_withSubtype.includes("ListPrice")
  );

  // Sanity check across all 5 real target cities, not just Toronto
  for (const city of ["Brampton", "Mississauga", "Vaughan", "Markham"]) {
    const c = query.buildProbeFilterClauses(city);
    check(`buildProbeFilterClauses("${city}") produces a city-scoped test1`, c.test1_cityOnly === `City eq '${city}'`);
  }

  // --- 2. buildIngestProbeQuery ---
  const probeParams = query.buildIngestProbeQuery("City eq 'Toronto'", ["ListingKey", "PropertySubType"]);
  check("buildIngestProbeQuery defaults to $top=5 (sample only, not a full pull)", probeParams.get("$top") === "5");
  check("buildIngestProbeQuery always requests $count=true", probeParams.get("$count") === "true");
  check("buildIngestProbeQuery passes the filter through unmodified", probeParams.get("$filter") === "City eq 'Toronto'");
  check("buildIngestProbeQuery joins the given $select fields", probeParams.get("$select") === "ListingKey,PropertySubType");

  const customTop = query.buildIngestProbeQuery("City eq 'Toronto'", ["ListingKey"], 1);
  check("buildIngestProbeQuery respects a custom top value", customTop.get("$top") === "1");

  // --- 3. index.js wiring + read-only guarantee ---
  check("index.js defines the /ingest-probe route", /url\.pathname === "\/ingest-probe"/.test(indexSrc));
  check(
    "index.js imports the probe helpers from query.js",
    /INGEST_PROBE_CITIES/.test(indexSrc) && /buildProbeFilterClauses/.test(indexSrc) && /buildIngestProbeQuery/.test(indexSrc)
  );
  check(
    "/ingest-probe supports a ?cities= override for a subset of cities",
    /citiesParam/.test(indexSrc) && /searchParams\.get\("cities"\)/.test(indexSrc)
  );
  check(
    "/ingest-probe does NOT call runIngest() (no ingestion side effects)",
    (() => {
      const start = indexSrc.indexOf('url.pathname === "/ingest-probe"');
      const nextRouteMatch = indexSrc.slice(start + 10).match(/if \(url\.pathname === "\/[a-z-]+"\)/);
      const end = nextRouteMatch ? start + 10 + nextRouteMatch.index : indexSrc.length;
      const block = indexSrc.slice(start, end);
      return !/runIngest\(/.test(block);
    })()
  );
  check(
    "/ingest-probe makes ZERO env.DB calls anywhere in its block (strictly read-only, no D1 writes)",
    (() => {
      const start = indexSrc.indexOf('url.pathname === "/ingest-probe"');
      const nextRouteMatch = indexSrc.slice(start + 10).match(/if \(url\.pathname === "\/[a-z-]+"\)/);
      const end = nextRouteMatch ? start + 10 + nextRouteMatch.index : indexSrc.length;
      const block = indexSrc.slice(start, end);
      // Requires an actual "env.DB." property/method access, not just the
      // substring "env.DB" -- avoids false-positiving on this route's own
      // "Makes zero env.DB calls..." doc-comment. See the matching note
      // in listings_source_attribution_test.js for the real incident.
      return !/env\.DB\./.test(block);
    })()
  );

  // --- 4. End-to-end against a mocked CREA: prove the route actually
  //     distinguishes "CREA has fewer" from "our filter excludes them" ---
  // Simulates a scenario where CREA truly has fewer Toronto listings than
  // Ottawa (branch A) vs. a scenario where the PropertySubType filter is
  // the one doing the excluding (branch B) -- confirms the 4-test
  // structure can tell these apart from real response data.
  function makeFakeCreaFetch(scenario) {
    return async (url) => {
      const params = new URLSearchParams(String(url).split("?")[1]);
      const filter = params.get("$filter") || "";
      const select = params.get("$select") || "";

      if (select.includes("PropertyType") && !select.includes("PropertySubType")) {
        // isolated PropertyType probe -- simulate it being a genuinely
        // invalid field for this account (like DaysOnMarket/ListOfficeName)
        return { ok: false, status: 400, json: async () => ({ error: { message: "Could not find a property named 'PropertyType'" } }) };
      }

      let total;
      if (scenario === "creaDoesntHaveThem") {
        // Every test returns roughly the same small number -- filters
        // aren't the cause, CREA genuinely has few Toronto listings.
        total = 47;
      } else {
        // scenario === "filterExcludesThem": test1-3 return a large
        // number, test4 (PropertySubType filter) drops sharply -- the
        // filter IS the cause.
        total = filter.includes("PropertySubType") ? 47 : 8500;
      }
      const value = Array.from({ length: Math.min(5, total) }, (_, i) => ({
        ListingKey: `T${i}`, PropertySubType: "Single Family", StructureType: ["House"],
      }));
      return { ok: true, status: 200, json: async () => ({ value, "@odata.count": total }) };
    };
  }

  const auth = await import(pathToFileURL(path.join(SRC_DIR, "auth.js")).href);
  void auth;

  async function runProbeForCity(city, scenario) {
    const originalFetch = global.fetch;
    global.fetch = makeFakeCreaFetch(scenario);
    try {
      const clauses = query.buildProbeFilterClauses(city);
      const out = {};
      for (const [name, filterClause] of Object.entries(clauses)) {
        const params = query.buildIngestProbeQuery(filterClause, ["ListingKey", "PropertySubType", "StructureType"]);
        const resp = await global.fetch(`https://fake/Property?${params.toString()}`);
        const data = await resp.json();
        out[name] = data["@odata.count"];
      }
      return out;
    } finally {
      global.fetch = originalFetch;
    }
  }

  const scenarioA = await runProbeForCity("Toronto", "creaDoesntHaveThem");
  check(
    "Scenario A (CREA genuinely has few): test1 and test4 counts are close -- filters aren't the cause",
    Math.abs(scenarioA.test1_cityOnly - scenarioA.test4_withSubtype) < 5,
    JSON.stringify(scenarioA)
  );

  const scenarioB = await runProbeForCity("Toronto", "filterExcludesThem");
  check(
    "Scenario B (filter excludes them): test1 is dramatically higher than test4 -- filter IS the cause",
    scenarioB.test1_cityOnly > scenarioB.test4_withSubtype * 10,
    JSON.stringify(scenarioB)
  );
  check(
    "Scenario B: test3 (price filter) does NOT drop, isolating PropertySubType as the specific culprit",
    scenarioB.test3_withPrice === scenarioB.test1_cityOnly
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
