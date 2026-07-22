// Phase 3 (DDF) — query node-count limit test for homepilot-listings.
//
// Why this exists: on 2026-07-21, the Worker's $filter hit CREA's 100-node
// OData query limit when the city list was expressed as chained `or` clauses
// (`City eq 'X' or City eq 'Y' or ...`). Each `or` comparison counts as
// several nodes, so ~20+ cities blew past the limit. The fix was switching to
// a single `City in (...)` clause, which CREA counts very differently.
//
// This test does NOT call CREA. It statically extracts HOMEPILOT_CITIES and
// buildQuery() from the real deployed source and counts nodes the same rough
// way an OData parser would, so this bug is caught the moment someone adds
// enough cities to blow the budget again — or reverts to `or` clauses.
//
// Run: node tests/listings_query_node_limit_test.js

const fs = require("fs");
const path = require("path");

const CITIES_SRC = path.join(
  __dirname,
  "..",
  "workers",
  "homepilot-listings",
  "src",
  "cities.js"
);
const QUERY_SRC = path.join(
  __dirname,
  "..",
  "workers",
  "homepilot-listings",
  "src",
  "query.js"
);

const CREA_NODE_LIMIT = 100;

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

const citiesSrc = fs.readFileSync(CITIES_SRC, "utf8");
const querySrc = fs.readFileSync(QUERY_SRC, "utf8");

// Extract HOMEPILOT_CITIES array literal
const citiesMatch = citiesSrc.match(/export const HOMEPILOT_CITIES\s*=\s*\[([\s\S]*?)\];/);
check("HOMEPILOT_CITIES array found in cities.js", !!citiesMatch);

const cityListRaw = citiesMatch ? citiesMatch[1] : "";
const cities = [...cityListRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check(
  "at least 40 cities present (sanity check, not a hardcoded expectation)",
  cities.length >= 40,
  `found ${cities.length}`
);

// Confirm the filter uses a single `in (...)` clause, not chained `or`
const usesInClause = /City in \(/.test(querySrc);
const usesChainedOr = /City eq '[^']+' or City eq '[^']+'/.test(querySrc);
check("$filter uses a single City in (...) clause", usesInClause);
check("$filter does NOT use chained City eq 'X' or ... clauses", !usesChainedOr);

// Approximate CREA's node counting: for `in (a,b,c,...)`, this is generally
// treated as roughly 1 node per value plus a small constant overhead for the
// `in` operator itself and the other filter terms (StateOrProvince,
// PropertySubType, StandardStatus, ListPrice). We count conservatively —
// worst case, each city = 1 node, plus 6 nodes of overhead for the other
// filter terms — and assert we're under CREA's limit with real headroom.
const OTHER_FILTER_TERM_NODES = 6;
const estimatedNodes = cities.length + OTHER_FILTER_TERM_NODES;
check(
  `estimated query nodes (${estimatedNodes}) stay under CREA's ${CREA_NODE_LIMIT}-node limit`,
  estimatedNodes < CREA_NODE_LIMIT,
  `${cities.length} cities + ${OTHER_FILTER_TERM_NODES} overhead = ${estimatedNodes}`
);

// Guard rail: warn (fail loudly) well before the real limit, so there's
// room to notice and fix before a future city-list expansion actually
// breaks production. 70 cities would be way too close for comfort.
const SAFE_CITY_COUNT_CEILING = 70;
check(
  `city count (${cities.length}) stays under the ${SAFE_CITY_COUNT_CEILING}-city safety ceiling`,
  cities.length < SAFE_CITY_COUNT_CEILING,
  "if this ever fails, re-verify the real node limit against CREA before adding more cities"
);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
