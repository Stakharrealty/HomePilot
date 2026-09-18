// PropTx display switch test (updated 2026-09-18 when the switch went ON).
//
// PROPTX_DISPLAY_ENABLED in workers/homepilot-listings/src/index.js was
// false while the PROPTX IDX Article 6.3 notices were missing. It was
// turned on after the notices shipped and the first full Mississauga
// ingest finished clean. This test now locks in the ON behaviour and
// proves the safety layers still hold with it on:
//   1. The switch is a plain `true` literal (flipping it is a deliberate,
//      reviewable one-line change) and not a named export.
//   2. /listings returns the real PropTx home through the real Worker
//      fetch handler, against real SQLite.
//   3. With the switch on, these still never show: a non-home (parking
//      space), an old DDF row (source NULL), a lease.
//   4. Paging past the 100th listing returns nothing and never queries
//      (Article 6.3(b)).
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
  check("PROPTX_DISPLAY_ENABLED is declared as a plain true literal", /^const PROPTX_DISPLAY_ENABLED = true;$/m.test(indexSrc));
  check("switch is not a named export (Workers treat named exports of the main module as entrypoints)",
    !/export\s+const\s+PROPTX_DISPLAY_ENABLED/.test(indexSrc));

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE listings (
    listing_key TEXT PRIMARY KEY, list_price REAL, city TEXT, postal_code TEXT,
    bedrooms INTEGER, bathrooms INTEGER, parking_total INTEGER, listing_url TEXT,
    brokerage_name TEXT, photos TEXT, last_updated TEXT, public_remarks TEXT,
    display_address TEXT, year_built INTEGER, lot_size_area REAL, lot_size_units TEXT,
    source TEXT, transaction_type TEXT, property_subtype TEXT
  )`);
  const ins = sqlite.prepare(`INSERT INTO listings (listing_key, list_price, city, listing_url, brokerage_name,
    photos, last_updated, source, transaction_type, property_subtype) VALUES (?, ?, 'Mississauga', '', 'TEST REALTY', '[]', ?, ?, ?, ?)`);
  ins.run("HOME1", 850000, "2026-09-18T04", "PROPTX", "For Sale", "Detached");
  ins.run("PARK1", 47800, "2026-09-18T03", "PROPTX", "For Sale", "Parking Space");
  ins.run("DDF1", 800000, "2026-09-18T02", null, null, null);
  ins.run("LEASE1", 3000, "2026-09-18T01", "PROPTX", "For Lease", "Detached");

  const worker = (await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href)).default;
  async function get(qs) {
    const log = [];
    const resp = await worker.fetch(
      new Request(`https://homepilot-listings.example/listings?${qs}`, { headers: { Origin: "https://myhomepilot.ca" } }),
      { DB: makeSqliteD1(sqlite, log) }, { waitUntil() {} });
    return { resp, body: await resp.json(), log };
  }

  const r = await get("city=Mississauga");
  const keys = (r.body.listings || []).map((l) => l.listingKey);
  check("/listings responds 200", r.resp.status === 200);
  check("switch on: the real PropTx home is returned", keys.includes("HOME1"), JSON.stringify(keys));
  check("switch on: parking space still never shown", !keys.includes("PARK1"));
  check("switch on: old DDF row still never shown", !keys.includes("DDF1"));
  check("switch on: lease still never shown", !keys.includes("LEASE1"));
  check("switch on: exactly 1 listing", r.body.count === 1, `${r.body.count}`);

  const past = await get("city=Mississauga&offset=100");
  check("offset 100: empty page (Article 6.3(b))", past.body.count === 0 && past.body.listings.length === 0);
  check("offset 100: database not queried", past.log.length === 0, `${past.log.length}`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
