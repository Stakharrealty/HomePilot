// Phase 6d (DDF) — StandardStatus $filter outage regression test for
// homepilot-listings.
//
// Why this exists: on 2026-07-24, CREA started rejecting any $filter
// clause containing `StandardStatus eq 'Active'` with a 400 error
// ("StandardStatus cannot be used in the $filter query option") -- a
// clause that had been working unchanged for weeks. This broke /ingest
// for all 49 cities simultaneously (a full outage of the live listings
// pipeline), because buildQuery/buildCityQuery both included it.
//
// Root-caused via a live isolation test (each filter clause tried alone
// and in combination against the real CREA API): StandardStatus was the
// ONLY clause CREA rejected. Every other clause (StateOrProvince,
// PropertySubType, ListPrice, City) worked fine alone and combined.
//
// Then confirmed the fix is safe, not just a workaround: a live sample of
// 50 Ontario Single Family listings with NO status filter at all came back
// 50/50 "Active" -- CREA's National Shared Pool feed only ever distributes
// Active listings by design. The StandardStatus filter was always
// redundant; removing it is not a compromise on data quality.
//
// This test does NOT call CREA. It statically checks the real deployed
// source so a future edit can't silently re-add `StandardStatus eq` to
// $filter (re-introducing the exact outage) without a test catching it
// before deploy.
//
// Run: node tests/listings_standard_status_filter_test.js

const fs = require("fs");
const path = require("path");

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

function main() {
  const querySrc = fs.readFileSync(path.join(SRC_DIR, "query.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");

  check(
    "query.js does NOT include 'StandardStatus eq' in any $filter clause (CREA rejects it -- confirmed live, 2026-07-24)",
    !/StandardStatus eq/.test(querySrc)
  );
  check(
    "query.js's rollback is documented (not just silently removed, so a future dev knows why)",
    /StandardStatus removed from \$filter 2026-07-24/.test(querySrc)
  );
  check(
    "the other real filter clauses are still present in buildQuery/buildCityQuery (this was a targeted removal, not a filter rewrite)",
    /StateOrProvince eq 'Ontario'/.test(querySrc) &&
    /PropertySubType eq 'Single Family'/.test(querySrc) &&
    /ListPrice gt/.test(querySrc)
  );
  check(
    "no leftover /debug-filter, /debug-status-sample, or /debug-city-query diagnostic routes in the deployed worker",
    !/debug-filter/.test(indexSrc) && !/debug-status-sample/.test(indexSrc) && !/debug-city-query/.test(indexSrc)
  );
  // db.js should still read/store whatever status value CREA does send
  // (harmless, and useful if this ever needs re-investigating) -- this
  // fix removed status from the QUERY filter, not from what we store.
  const dbSrc = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
  check(
    "db.js still stores r.StandardStatus on ingest (we removed it from $filter, not from what we record)",
    /r\.StandardStatus/.test(dbSrc)
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
