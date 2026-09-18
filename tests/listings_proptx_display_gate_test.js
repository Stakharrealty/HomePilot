// PropTx display gate test (2026-09-18).
//
// Why this exists: PropTx IDX listings went live on myhomepilot.ca before
// the PROPTX IDX Data Agreement Article 6.3 notices were on the page.
// PROPTX_DISPLAY_ENABLED in workers/homepilot-listings/src/index.js hides
// them from buyers until the notices are added.
//
// What this proves, end to end through the Worker's real fetch handler
// (not a regex on the source alone):
//   1. With the switch off, /listings returns count 0 and an empty list,
//      even when a valid, visible PropTx row IS in the database.
//   2. The database is never even queried by /listings while off.
//   3. The switch is a plain `false` literal in source, so a flip to true
//      is a deliberate, reviewable one-line change.
//   4. The underlying query still works: calling getListingsByCity
//      directly against the same real SQLite row returns it -- so the
//      empty result above comes from the switch, not a broken query.
//
// When the Article 6.3 notices ship and the switch flips to true, update
// check 1/2/3 in the same commit to expect listings again.
//
// Run: node --no-warnings tests/listings_proptx_display_gate_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

// Minimal D1-shaped wrapper around real node:sqlite, recording every query.
function makeSqliteD1(sqlite, log) {
  return {
    prepare(sql) {
      log.push(sql);
      let params = [];
      const stmt = {
        bind(...p) { params = p; return stmt; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async run() { sqlite.prepare(sql).run(...params); return { success: true }; },
      };
      return stmt;
    },
  };
}

(async () => {
  const indexSrc = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");

  // 3. switch is a plain literal
  check(
    "PROPTX_DISPLAY_ENABLED is declared as a plain false literal",
    /^const PROPTX_DISPLAY_ENABLED = false;$/m.test(indexSrc)
  );
  check(
    "switch is not a named export (Workers treat named exports of the main module as entrypoints)",
    !/export\s+const\s+PROPTX_DISPLAY_ENABLED/.test(indexSrc)
  );

  // Real SQLite table with the columns getListingsByCity selects/filters on,
  // seeded with one fully valid, buyer-visible PropTx row.
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE listings (
    listing_key TEXT PRIMARY KEY, list_price REAL, city TEXT, postal_code TEXT,
    bedrooms INTEGER, bathrooms INTEGER, parking_total INTEGER, listing_url TEXT,
    brokerage_name TEXT, photos TEXT, last_updated TEXT, public_remarks TEXT,
    display_address TEXT, year_built INTEGER, lot_size_area REAL, lot_size_units TEXT,
    structure_type TEXT, common_interest TEXT, property_attached INTEGER,
    source TEXT, transaction_type TEXT, property_subtype TEXT
  )`);
  sqlite.prepare(`INSERT INTO listings (listing_key, list_price, city, listing_url, brokerage_name,
    photos, last_updated, source, transaction_type, property_subtype)
    VALUES ('W1', 850000, 'Mississauga', '', 'TEST REALTY', '[]', '2026-09-18T00:00:00Z', 'PROPTX', 'For Sale', 'Detached')`).run();

  // 4. query itself still returns the row
  const dbModule = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  const directLog = [];
  const direct = await dbModule.getListingsByCity(makeSqliteD1(sqlite, directLog), "Mississauga", 20, null, 0, null);
  check("getListingsByCity itself still returns the valid PropTx row (query not broken)", direct.length === 1, `got ${direct.length}`);

  // 1 + 2. Worker /listings route with the switch off
  const worker = (await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href)).default;
  const routeLog = [];
  const env = { DB: makeSqliteD1(sqlite, routeLog) };
  const resp = await worker.fetch(
    new Request("https://homepilot-listings.example/listings?city=Mississauga", { headers: { Origin: "https://myhomepilot.ca" } }),
    env,
    { waitUntil() {} }
  );
  const body = await resp.json();
  check("/listings responds 200", resp.status === 200, `status ${resp.status}`);
  check("/listings returns count 0 while switch is off", body.count === 0, JSON.stringify(body).slice(0, 200));
  check("/listings returns an empty listings array while switch is off", Array.isArray(body.listings) && body.listings.length === 0);
  check("/listings does not query the database at all while switch is off", routeLog.length === 0, `${routeLog.length} queries`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
