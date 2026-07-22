// Phase 2 (DDF) — module load verification test for homepilot-listings.
//
// Why this exists: on 2026-07-21, the single-file index.js was split into
// auth.js, cities.js, query.js, db.js + a thin index.js (mirroring the main
// app's src/ structure). Splitting into modules with import/export can
// silently break at deploy time if an export name is wrong or a module has
// a syntax error -- this test catches that locally, before any deploy,
// mirroring what tests/browser_load_verification.js does for the main app.
//
// This test does NOT call CREA or touch D1. It only verifies the modules
// import cleanly in Node and export what index.js actually expects.
//
// Requires workers/homepilot-listings/package.json to have "type": "module"
// (scoped to that folder only) so Node treats these files as ES modules,
// since the repo root package.json is CommonJS.
//
// Run: node tests/listings_module_load_test.js

const path = require("path");
const { pathToFileURL } = require("url");

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

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

async function main() {
  // auth.js
  try {
    const auth = await import(pathToFileURL(path.join(SRC_DIR, "auth.js")).href);
    check("auth.js imports without error", true);
    check("auth.js exports getAccessToken (function)", typeof auth.getAccessToken === "function");
    check("auth.js exports TOKEN_URL (string)", typeof auth.TOKEN_URL === "string");
  } catch (e) {
    check("auth.js imports without error", false, e.message);
  }

  // cities.js
  try {
    const cities = await import(pathToFileURL(path.join(SRC_DIR, "cities.js")).href);
    check("cities.js imports without error", true);
    check(
      "cities.js exports HOMEPILOT_CITIES (non-empty array)",
      Array.isArray(cities.HOMEPILOT_CITIES) && cities.HOMEPILOT_CITIES.length > 0
    );
  } catch (e) {
    check("cities.js imports without error", false, e.message);
  }

  // query.js
  try {
    const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);
    check("query.js imports without error", true);
    check("query.js exports buildQuery (function)", typeof query.buildQuery === "function");
    check("query.js exports API_BASE (string)", typeof query.API_BASE === "string");
    // Actually call it -- catches runtime errors a static check would miss
    const params = query.buildQuery(20, 0);
    check(
      "buildQuery() returns a URLSearchParams with $filter and $select",
      params instanceof URLSearchParams && params.has("$filter") && params.has("$select")
    );
  } catch (e) {
    check("query.js imports without error", false, e.message);
  }

  // db.js
  try {
    const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
    check("db.js imports without error", true);
    check("db.js exports upsertListing (function)", typeof db.upsertListing === "function");
    check(
      "db.js exports deleteStaleListings (function) -- added 2026-07-21 for scheduled refresh",
      typeof db.deleteStaleListings === "function"
    );
  } catch (e) {
    check("db.js imports without error", false, e.message);
  }

  // ingest.js -- added 2026-07-21, shared between /ingest route and
  // scheduled cron trigger so there's one code path, not two
  try {
    const ingest = await import(pathToFileURL(path.join(SRC_DIR, "ingest.js")).href);
    check("ingest.js imports without error", true);
    check("ingest.js exports runIngest (function)", typeof ingest.runIngest === "function");
  } catch (e) {
    check("ingest.js imports without error", false, e.message);
  }

  // index.js -- the actual entry point, must import all of the above cleanly
  // and produce a valid Worker export (default export with fetch AND
  // scheduled handlers -- scheduled added 2026-07-21 for the daily cron)
  try {
    const entry = await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href);
    check("index.js imports without error (all imports resolve)", true);
    check(
      "index.js default export has a fetch(request, env) handler",
      !!entry.default && typeof entry.default.fetch === "function"
    );
    check(
      "index.js default export has a scheduled(event, env, ctx) handler",
      !!entry.default && typeof entry.default.scheduled === "function"
    );
  } catch (e) {
    check("index.js imports without error (all imports resolve)", false, e.message);
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
