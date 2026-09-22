// Property classification test -- PropTx (rewritten 2026-09-18).
//
// History: the previous version of this test (2026-07-29) locked in the
// DDF-era rules (structure_type / common_interest / property_attached).
// PropTx leaves those fields empty on every real row, so every PropTx
// listing classified as NULL. Classification now reads property_subtype
// through home-types.js. DDF rows are unreachable (source = 'PROPTX' is
// required on the read path), so the DDF assertions no longer describe
// anything real and were replaced, not kept alongside.
//
// Why real SQLite: PROPERTY_TYPE_FILTERS, SHOWN_HOMES_CLAUSE and the
// derived_property_type CASE are SQL evaluated by the database. node:sqlite
// runs the exact same strings getListingsByCity sends to D1.
//
// Seed data: the real label counts from the /proptx-subtype-census run on
// 2026-09-18 (all ~62k active residential for-sale PropTx listings).
// Labels that census found only in its 100-row uncovered sample use the
// sample count and are marked SAMPLE.
//
// What this proves:
//   1. Every approved label lands under the button Sandeep approved.
//   2. "Semi-Detached " (trailing space, as PropTx really sends it) is a
//      Semi -- not dropped, not NULL.
//   3. Every blocked label (parking, locker, land, farm, co-op, mobile,
//      etc.) is excluded by SHOWN_HOMES_CLAUSE, and so is any unknown
//      future label.
//   4. The 4 button filters are mutually exclusive.
//   5. derived_property_type agrees with the filters (same strings).
//   6. End to end through getListingsByCity: a real parking-space row is
//      never returned; a trailing-space semi comes back as 'semi'; a
//      duplex shows under All with no button.
//   7. JS classifySubtype (used by ingest) and the SQL (used by the read
//      path) agree on every label -- the two layers can't drift.
//
// Run: node --no-warnings tests/listings_property_classification_test.js

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

// label -> [real census count, expected: button | "all" (shown, no button) | "blocked"]
const CENSUS = [
  ["Detached", 32656, "detached"],
  ["Condo Apartment", 10375, "condo"],
  ["Vacant Land", 5089, "blocked"],
  ["Att/Row/Townhouse", 3852, "town"],
  ["Condo Townhouse", 3808, "condo"],
  ["Duplex", 675, "all"],
  ["Rural Residential", 476, "detached"],
  ["Farm", 471, "blocked"],
  ["Common Element Condo", 296, "condo"],
  ["Triplex", 294, "all"],
  ["Multiplex", 262, "all"],
  ["Other", 257, "blocked"],
  ["Link", 176, "semi"],
  ["Fourplex", 152, "all"],
  ["Detached Condo", 98, "condo"],
  ["Vacant Land Condo", 95, "blocked"],
  ["Parking Space", 81, "blocked"],
  ["Co-op Apartment", 59, "blocked"],
  ["Semi-Detached Condo", 48, "condo"],
  ["Store W Apt/Office", 45, "blocked"],
  ["Leasehold Condo", 44, "condo"],
  ["Co-Ownership Apartment", 33, "blocked"],
  ["Locker", 13, "blocked"],
  ["Cottage", 10, "blocked"],
  ["Semi-Detached ", 60, "semi"],      // SAMPLE -- trailing space is real
  ["MobileTrailer", 31, "blocked"],    // SAMPLE
  ["Timeshare", 3, "blocked"],         // SAMPLE
  ["Modular Home", 6, "blocked"],      // SAMPLE
  ["Some Future Label", 5, "blocked"], // not from PropTx: proves unknown labels are blocked
];

(async () => {
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  const ht = await import(pathToFileURL(path.join(SRC_DIR, "home-types.js")).href);
  const F = db.PROPERTY_TYPE_FILTERS;

  check("4 button filters exist", ht.BUTTON_TYPES.every((b) => typeof F[b] === "string"));
  check("filters match on TRIM(property_subtype), not the empty DDF fields",
    Object.values(F).every((c) => c.startsWith("TRIM(property_subtype) IN (") && !/structure_type|common_interest|property_attached/.test(c)));

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE listings (
    listing_key TEXT PRIMARY KEY, list_price REAL, city TEXT, postal_code TEXT,
    bedrooms INTEGER, bathrooms INTEGER, parking_total INTEGER, listing_url TEXT,
    brokerage_name TEXT, photos TEXT, last_updated TEXT, public_remarks TEXT,
    display_address TEXT, year_built INTEGER, lot_size_area REAL, lot_size_units TEXT,
    tax_annual_amount REAL, tax_year INTEGER, association_fee REAL, association_fee_frequency TEXT,
    garage_type TEXT, basement TEXT, cooling TEXT, heat_type TEXT, mls_number TEXT, listed_date TEXT, virtual_tour_url TEXT, parking_spaces INTEGER,
    latitude REAL, longitude REAL,
    property_subtype TEXT, source TEXT, transaction_type TEXT, standard_status TEXT,
    lot_width REAL, lot_depth REAL, lot_size_source TEXT, living_area_range TEXT, approximate_age TEXT
  )`);
  const ins = sqlite.prepare(`INSERT INTO listings (listing_key, list_price, city, listing_url, brokerage_name, photos,
    last_updated, property_subtype, source, transaction_type, standard_status) VALUES (?, 500000, 'Seedville', '', 'B', '[]', ?, ?, 'PROPTX', 'For Sale', 'Active')`);
  // standard_status + a fresh last_updated are part of the visibility contract
  // (VISIBLE_LISTING_CLAUSE in db.js, 2026-09-22).
  const FRESH = new Date().toISOString();

  let seq = 0;
  sqlite.exec("BEGIN");
  for (const [label, count] of CENSUS) for (let i = 0; i < count; i++) ins.run(`S${seq++}`, FRESH, label);
  sqlite.exec("COMMIT");
  const total = CENSUS.reduce((a, [, n]) => a + n, 0);
  check(`seeded ${total} rows at real census scale`, seq === total);

  const count = (where) => sqlite.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${where}`).get().n;
  const q = (s) => `'${s.replace(/'/g, "''")}'`;

  // 1 + 3 + 7: every label, SQL vs expected vs JS
  for (const [label, , expected] of CENSUS) {
    const where = `property_subtype = ${q(label)}`;
    const shownSql = count(`${where} AND ${db.SHOWN_HOMES_CLAUSE}`) > 0;
    const buttons = ht.BUTTON_TYPES.filter((b) => count(`${where} AND ${F[b]}`) > 0);
    const js = ht.classifySubtype(label);
    let ok;
    if (expected === "blocked") ok = !shownSql && buttons.length === 0 && js.shown === false;
    else if (expected === "all") ok = shownSql && buttons.length === 0 && js.shown === true && js.type === null;
    else ok = shownSql && buttons.length === 1 && buttons[0] === expected && js.shown === true && js.type === expected;
    check(`"${label}" -> ${expected} (SQL and ingest agree)`, ok,
      `sqlShown=${shownSql} buttons=${JSON.stringify(buttons)} js=${JSON.stringify(js)}`);
  }

  // 2: trailing-space semi specifically
  check('"Semi-Detached " (trailing space) counts under Semi', count(`property_subtype = 'Semi-Detached ' AND ${F.semi}`) === 60);

  // 4: mutual exclusivity
  const B = ht.BUTTON_TYPES;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const ov = count(`(${F[B[i]]}) AND (${F[B[j]]})`);
    check(`'${B[i]}' and '${B[j]}' never overlap`, ov === 0, `overlap ${ov}`);
  }

  // Totals at real scale
  const sum = (kind) => CENSUS.filter((c) => c[2] === kind).reduce((a, c) => a + c[1], 0);
  check("detached button count = Detached + Rural Residential", count(F.detached) === sum("detached"), `${count(F.detached)}`);
  check("semi button count = Semi-Detached(trailing space) + Link", count(F.semi) === sum("semi"));
  check("town button count = Att/Row/Townhouse", count(F.town) === sum("town"));
  check("condo button count = all 6 condo labels", count(F.condo) === sum("condo"));
  check("blocked rows never pass the homes-only guard", count(`NOT (${db.SHOWN_HOMES_CLAUSE})`) === sum("blocked"));

  // 5: derived CASE agrees with filters
  const caseSql = `CASE WHEN ${F.condo} THEN 'condo' WHEN ${F.town} THEN 'town' WHEN ${F.semi} THEN 'semi' WHEN ${F.detached} THEN 'detached' ELSE NULL END`;
  const derived = Object.fromEntries(sqlite.prepare(`SELECT ${caseSql} AS t, COUNT(*) AS n FROM listings WHERE ${db.SHOWN_HOMES_CLAUSE} GROUP BY t`).all().map((r) => [r.t ?? "null", r.n]));
  check("derived type counts equal the button filter counts",
    B.every((b) => derived[b] === count(F[b])) && derived.null === sum("all"), JSON.stringify(derived));

  // 6: end to end through getListingsByCity with real sample rows
  const e2e = new DatabaseSync(":memory:");
  e2e.exec(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='listings'").get().sql);
  const ins2 = e2e.prepare(`INSERT INTO listings (listing_key, list_price, city, listing_url, brokerage_name, photos,
    last_updated, property_subtype, source, transaction_type, standard_status) VALUES (?, ?, 'Mississauga', '', 'B', '[]', ?, ?, 'PROPTX', 'For Sale', 'Active')`);
  ins2.run("W12943244", 47800, FRESH, "Parking Space");  // real row from the first page
  ins2.run("W12326045", 2880000, FRESH, "Detached");     // real row
  ins2.run("SEMI1", 900000, "2026-09-18T03", "Semi-Detached ");
  ins2.run("DUP1", 1200000, "2026-09-18T04", "Duplex");
  const d1 = {
    prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: e2e.prepare(sql).all(...a) }; } }; return st; },
  };
  const all = await db.getListingsByCity(d1, "Mississauga", 50, null, 0, null);
  const keys = all.map((l) => l.listingKey);
  check("real parking-space row W12943244 is never returned", !keys.includes("W12943244"), JSON.stringify(keys));
  check("all 3 real homes are returned under All", ["W12326045", "SEMI1", "DUP1"].every((k) => keys.includes(k)));
  const byKey = Object.fromEntries(all.map((l) => [l.listingKey, l.propertyType]));
  check("trailing-space semi comes back labelled 'semi'", byKey.SEMI1 === "semi");
  check("detached comes back labelled 'detached'", byKey.W12326045 === "detached");
  check("duplex shows with no button label (null)", byKey.DUP1 === null);
  const semiOnly = await db.getListingsByCity(d1, "Mississauga", 50, "semi", 0, null);
  check("Semi button returns only the semi", semiOnly.length === 1 && semiOnly[0].listingKey === "SEMI1");
  const cheap = await db.getListingsByCity(d1, "Mississauga", 50, null, 0, 50000);
  check("a $50k budget returns nothing (the $47,800 parking spot can't sneak in as 'within budget')", cheap.length === 0, JSON.stringify(cheap.map((l) => l.listingKey)));

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
