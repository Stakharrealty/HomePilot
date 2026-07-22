// Phase 3 (DDF) — price floor regression test for homepilot-listings.
//
// Why this exists: on 2026-07-21, real /ingest testing surfaced actual
// production junk in CREA's data -- Single Family listings priced at $1,
// $2, and $5000 (Pickering, Richmond Hill, Kitchener). These are real
// agent-entered placeholder prices, not a parsing bug. The original filter
// only checked `ListPrice ne null`, which does not exclude a non-null junk
// value like $1. The fix was `ListPrice gt 50000` -- comfortably below any
// real Ontario single family home price, so it can't accidentally exclude
// legitimate cheap listings, but high enough to catch $1/$2/$5000 junk.
//
// This test does NOT call CREA. It statically checks the real deployed
// source for a real minimum-price filter, so a future edit can't silently
// weaken this back to `ne null` (or remove it entirely) without a test
// catching it before deploy.
//
// Run: node tests/listings_price_floor_test.js

const fs = require("fs");
const path = require("path");

const QUERY_SRC = path.join(
  __dirname,
  "..",
  "workers",
  "homepilot-listings",
  "src",
  "query.js"
);

// The floor must be at least this high to actually catch the known junk
// values we found in production ($1, $2, $5000). Set well above $5000
// with margin, but nowhere near real market prices.
const MIN_ACCEPTABLE_FLOOR = 10000;

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

const src = fs.readFileSync(QUERY_SRC, "utf8");

// Extract the $filter line
const filterMatch = src.match(/"\$filter":\s*`([^`]+)`/);
check("$filter found in query.js", !!filterMatch);
const filterStr = filterMatch ? filterMatch[1] : "";

// Must NOT rely on just "ne null" for price (that's what let $1 junk through)
const hasWeakNullCheck = /ListPrice ne null/.test(filterStr) && !/ListPrice gt/.test(filterStr);
check(
  "$filter does NOT rely solely on 'ListPrice ne null'",
  !hasWeakNullCheck,
  "a bare null-check does not exclude non-null junk values like $1"
);

// query.js (post-2026-07-21 module split) interpolates a MIN_LIST_PRICE
// constant into the filter string rather than a literal number, so check
// both: the filter references the constant, and the constant itself has a
// real numeric value.
const usesInterpolatedFloor = /ListPrice gt \$\{MIN_LIST_PRICE\}/.test(filterStr);
const literalGtMatch = filterStr.match(/ListPrice gt (\d+)/);
check(
  "$filter contains a 'ListPrice gt N' threshold (literal or interpolated constant)",
  usesInterpolatedFloor || !!literalGtMatch
);

const constMatch = src.match(/const MIN_LIST_PRICE\s*=\s*(\d+)/);
if (usesInterpolatedFloor) {
  check("MIN_LIST_PRICE constant found in query.js", !!constMatch);
}

const gtMatch = literalGtMatch || constMatch;
if (gtMatch) {
  const floorValue = parseInt(gtMatch[1], 10);
  check(
    `price floor ($${floorValue}) is high enough to exclude known junk ($1/$2/$5000)`,
    floorValue >= MIN_ACCEPTABLE_FLOOR,
    `floor is $${floorValue}, needs to be >= $${MIN_ACCEPTABLE_FLOOR}`
  );
  check(
    `price floor ($${floorValue}) is not absurdly high (sanity check, avoid excluding real cheap listings)`,
    floorValue <= 200000,
    `floor is $${floorValue} -- this seems too high, real cheap Ontario listings could be excluded`
  );
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
