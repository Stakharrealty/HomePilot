// Listing detail API groundwork: GET /listing?key=... plus the list-API
// changes made with it (no latitude/longitude, heatType exposed).
// Real Worker fetch handler against real in-memory SQLite (no network).
//
// Run: node --no-warnings tests/listings_detail_endpoint_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
let passed = 0, failed = 0;
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
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE listings (
    listing_key TEXT PRIMARY KEY, list_price REAL, city TEXT, community TEXT, postal_code TEXT,
    bedrooms INTEGER, bathrooms INTEGER, parking_total INTEGER, listing_url TEXT,
    brokerage_name TEXT, photos TEXT, last_updated TEXT, public_remarks TEXT,
    display_address TEXT, year_built INTEGER, lot_size_area REAL, lot_size_units TEXT,
    tax_annual_amount REAL, tax_year INTEGER, association_fee REAL, association_fee_frequency TEXT,
    garage_type TEXT, basement TEXT, cooling TEXT, heat_type TEXT, mls_number TEXT, listed_date TEXT, virtual_tour_url TEXT, parking_spaces INTEGER,
    latitude REAL, longitude REAL, public_remarks_full TEXT, photos_full TEXT,
    source TEXT, transaction_type TEXT, property_subtype TEXT, standard_status TEXT,
    lot_width REAL, lot_depth REAL, lot_size_source TEXT, living_area_range TEXT, approximate_age TEXT
  )`);
  const ins = sqlite.prepare(`INSERT INTO listings (listing_key, list_price, city, listing_url, brokerage_name, photos, last_updated,
    public_remarks, public_remarks_full, photos_full, heat_type, latitude, longitude, tax_annual_amount, source, transaction_type, property_subtype, standard_status)
    VALUES (?, ?, 'Mississauga', '', 'TEST REALTY', ?, ?, ?, ?, ?, ?, 43.59, -79.64, 4100, ?, ?, ?, ?)`);
  // last_updated and standard_status are part of the visibility contract now
  // (VISIBLE_LISTING_CLAUSE in db.js, 2026-09-22): a listing that stops
  // arriving from PropTx freezes its last_updated, which is the only signal
  // that it is no longer for sale.
  const FRESH = new Date().toISOString();
  const STALE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const P = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => `https://cdn.example.com/${i}.jpg`));
  ins.run("HOME1", 850000, P(2), FRESH, "short...", "FULL untruncated remarks text", P(30), "Forced Air", "PROPTX", "For Sale", "Detached", "Active");
  ins.run("HOME2", 600000, P(3), FRESH, "only short", null, null, null, "PROPTX", "For Sale", "Condo Apartment", "Active");
  ins.run("PARK1", 47800, P(1), FRESH, "p", null, null, null, "PROPTX", "For Sale", "Parking Space", "Active");
  ins.run("DDF1", 800000, P(1), FRESH, "d", null, null, null, null, null, null, null);
  ins.run("LEASE1", 3000, P(1), FRESH, "l", null, null, null, "PROPTX", "For Lease", "Detached", "Active");
  // A listing that sold: it left the PropTx feed, so its row froze 30 days ago.
  ins.run("SOLD1", 900000, P(1), STALE, "s", null, null, null, "PROPTX", "For Sale", "Detached", "Active");
  // A listing whose status was updated in place before it left the feed.
  ins.run("CLOSED1", 910000, P(1), FRESH, "c", null, null, null, "PROPTX", "For Sale", "Detached", "Closed");

  const worker = (await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href)).default;
  const get = async (qs, p = "/listing") => {
    const log = [];
    const resp = await worker.fetch(
      new Request(`https://homepilot-listings.example${p}?${qs}`, { headers: { Origin: "https://myhomepilot.ca" } }),
      { DB: makeSqliteD1(sqlite, log) }, { waitUntil() {} });
    return { resp, body: await resp.json(), log };
  };

  // --- /listing
  const a = await get("key=HOME1");
  check("HOME1 returns 200 with a listing", a.resp.status === 200 && a.body.listing && a.body.listing.listingKey === "HOME1");
  check("full untruncated remarks preferred over the short column", a.body.listing.publicRemarks === "FULL untruncated remarks text");
  check("full photo set (30) preferred over the list photos (2)", a.body.listing.photos.length === 30);
  check("derived property type present", a.body.listing.propertyType === "detached", String(a.body.listing.propertyType));
  check("heatType exposed", a.body.listing.heatType === "Forced Air");
  check("stored tax figure exposed", a.body.listing.taxAnnualAmount === 4100);
  check("latitude/longitude are NOT in the response", !("latitude" in a.body.listing) && !("longitude" in a.body.listing));
  check("CORS header present for the app origin", !!a.resp.headers.get("Access-Control-Allow-Origin"));

  const b = await get("key=HOME2");
  check("falls back to list remarks/photos when full columns are empty", b.body.listing.publicRemarks === "only short" && b.body.listing.photos.length === 3);
  check("condo classified as condo", b.body.listing.propertyType === "condo");

  const hidden = ["PARK1", "DDF1", "LEASE1", "NOPE"];
  for (const k of hidden) {
    const r = await get(`key=${k}`);
    check(`${k}: 404 (non-home / old DDF row / lease / unknown key are never served)`, r.resp.status === 404 && !r.body.listing);
  }
  const noKey = await get("");
  check("missing key -> 400", noKey.resp.status === 400);
  const evil = await get("key=" + encodeURIComponent("x' OR '1'='1"));
  check("SQL-injection-shaped key -> 404 and never reaches the database", evil.resp.status === 404 && evil.log.length === 0, evil.log.join("|"));

  // --- /listings (list) changes
  const list = await get("city=Mississauga", "/listings");
  const l0 = (list.body.listings || []).find((x) => x.listingKey === "HOME1");
  check("/listings still returns HOME1", !!l0);
  check("/listings: no latitude/longitude", l0 && !("latitude" in l0) && !("longitude" in l0));
  check("/listings: heatType exposed", l0 && l0.heatType === "Forced Air");
  check("/listings: list still uses the short remarks column", l0 && l0.publicRemarks === "short...");
  check("/listings: SQL no longer selects latitude/longitude", !list.log.some((q) => /\blatitude\b|\blongitude\b/.test(q)));

  // --- staleness (added 2026-09-22). Nothing in the pipeline deletes a
  // listing, so the read path is the only thing standing between a sold home
  // and a buyer being shown it as for-sale. 11,121 stale rows were served live
  // for months before this existed.
  const soldDetail = await get("key=SOLD1");
  check("a listing that left the feed 30 days ago is 404 on /listing", soldDetail.resp.status === 404);
  const closedDetail = await get("key=CLOSED1");
  check("a listing marked Closed is 404 on /listing", closedDetail.resp.status === 404);
  const freshList = await get("city=Mississauga", "/listings");
  const listedKeys = (freshList.body.listings || []).map((x) => x.listingKey);
  check("a stale listing never appears in /listings", !listedKeys.includes("SOLD1"), listedKeys.join(","));
  check("a Closed listing never appears in /listings", !listedKeys.includes("CLOSED1"), listedKeys.join(","));
  check("fresh Active listings are still served", listedKeys.includes("HOME1") && listedKeys.includes("HOME2"));

  const dbSrc = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
  check("both queries share one visibility clause (they cannot drift apart)",
    (dbSrc.match(/VISIBLE_LISTING_CLAUSE/g) || []).length >= 3);
  check("the freshness bound is a named constant, not a magic number",
    /MAX_LISTING_AGE_HOURS\s*=\s*\d+/.test(dbSrc));

  const idx = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");
  check("/listing route is gated by PROPTX_DISPLAY_ENABLED", /url\.pathname === "\/listing"[\s\S]{0,600}PROPTX_DISPLAY_ENABLED/.test(idx));

  // --- the removed diagnostic routes must stay removed (2026-09-22 audit).
  for (const route of ["/proptx-subtype-census", "/proptx-ingest-status", "/proptx-first-page-summary",
                       "/proptx-check-unique-constraint", "/proptx-check-partial-ingest"]) {
    check(`${route} is gone from the request path`, !idx.includes(`url.pathname === "${route}"`));
    const r = await get("", route);
    check(`${route} returns 404`, r.resp.status === 404);
  }
  // The token may be NAMED in comments; what matters is that no code in the
  // fetch handler reads it. Only the cron handler should.
  check("PropTx token is never read from an unauthenticated request path",
    !/env\.PROPTX_IDX_TOKEN/.test(idx.slice(0, idx.indexOf("async scheduled"))));
  check("500 responses do not leak the underlying error message",
    !/error:\s*err\.message/.test(idx));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
