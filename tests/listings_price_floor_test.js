// Price floor: $1 listings must never reach a buyer.
//
// Some agents list a real, ordinary house at $1 so it sorts to the top of every
// low-to-high search. HomePilot orders by list_price ASC, so those listings sat
// at position 1 of the affected city's page -- and because they are genuine
// Detached / Semi / Townhouse / Condo records at real addresses, no home-type
// rule could ever catch them. Only a price floor can.
//
// The seed data below is REAL: the 36 listings live in production on
// 2026-09-23, with their true subtypes and cities, alongside the genuinely
// cheap-but-real inventory that must stay visible.
//
// Why real SQLite: the floor is part of VISIBLE_LISTING_CLAUSE, which is SQL.
// node:sqlite runs the exact string both endpoints send to D1, so this cannot
// pass while the real query fails.
//
// Run: node --no-warnings tests/listings_price_floor_test.js

const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
const load = (f) => import(pathToFileURL(path.join(SRC, f)).href);

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail ? " :: " + detail : "")); }
}

// Real $1 listings from production, with their real subtypes. Every one of
// these is a normal home type -- that is the whole point.
const GAMED = [
  ["G1", 1, "Aurora", "Detached", "184 Sunset Vista Court"],
  ["G2", 1, "Aurora", "Att/Row/Townhouse", "0 Street A - Espresso Road"],
  ["G3", 1, "Brampton", "Semi-Detached", "33 Coppermill Drive"],
  ["G4", 1, "Mississauga", "Detached", "1228 Haig Boulevard"],
  ["G5", 1, "Toronto C01", "Condo Apartment", "135 East Liberty Street 1503"],
  ["G6", 1, "Toronto C01", "Triplex", "147 Euclid Avenue"],
  ["G7", 1, "Toronto C03", "Multiplex", "374 Atlas Avenue"],
  ["G8", 1, "Oakville", "Detached", "2483 Burnhamthorpe Road"],
  ["G9", 1, "Hamilton", "Detached", "2 Norfolk Street N"],
];

// Real inventory that is genuinely cheap and MUST stay visible.
const REAL_CHEAP = [
  ["R1", 21000, "Collingwood", "Condo Apartment", "9 Harbour Street 6112/6114"],
  ["R2", 48500, "Collingwood", "Condo Apartment", "9 Harbour Street E 6411/6413"],
  ["R3", 119000, "Hamilton", "Detached", "a genuinely cheap rural home"],
  ["R4", 185000, "Welland", "Detached", "a genuinely cheap rural home"],
  ["R5", 529999, "Grand Valley", "Detached", "an ordinary home"],
];

(async () => {
  const db = await load("db.js");

  // --- 1. the constant itself
  check("MIN_LISTING_PRICE is defined and above the gamed band",
    typeof db.MIN_LISTING_PRICE === "number" && db.MIN_LISTING_PRICE > 1,
    String(db.MIN_LISTING_PRICE));
  // A floor of $2 would clear today's 36 and reopen the exploit tomorrow at $2.
  check("the floor is high enough that the next cheapest rung is not gameable",
    db.MIN_LISTING_PRICE >= 1000, String(db.MIN_LISTING_PRICE));
  // Production's cheapest REAL listings are $21,000 (Collingwood fractional
  // condos). The floor must stay below them or it starts hiding real homes.
  check("the floor stays below the cheapest real listing in production ($21,000)",
    db.MIN_LISTING_PRICE < 21000, String(db.MIN_LISTING_PRICE));

  check("the floor is part of the shared visibility clause, so BOTH endpoints get it",
    db.VISIBLE_LISTING_CLAUSE.includes("list_price >= " + db.MIN_LISTING_PRICE),
    db.VISIBLE_LISTING_CLAUSE);
  // The clause carries exactly one bind (the freshness cutoff). If the floor
  // were bound instead of inlined, every caller's positional bind order would
  // shift and D1 would silently bind the wrong values.
  check("the clause still has exactly one placeholder, so bind order is unchanged",
    db.VISIBLE_LISTING_CLAUSE.split("?").length - 1 === 1, db.VISIBLE_LISTING_CLAUSE);

  // --- 2. end to end through the real query
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE listings (" +
    "listing_key TEXT PRIMARY KEY, list_price REAL, city TEXT, community TEXT, postal_code TEXT," +
    "bedrooms INTEGER, bathrooms INTEGER, parking_total INTEGER, listing_url TEXT," +
    "brokerage_name TEXT, photos TEXT, last_updated TEXT, public_remarks TEXT," +
    "display_address TEXT, year_built INTEGER, lot_size_area REAL, lot_size_units TEXT," +
    "tax_annual_amount REAL, tax_year INTEGER, association_fee REAL, association_fee_frequency TEXT," +
    "garage_type TEXT, basement TEXT, cooling TEXT, heat_type TEXT, mls_number TEXT, listed_date TEXT," +
    "virtual_tour_url TEXT, parking_spaces INTEGER, latitude REAL, longitude REAL," +
    "property_subtype TEXT, source TEXT, transaction_type TEXT, standard_status TEXT," +
    "city_district TEXT, lot_width REAL, lot_depth REAL, lot_size_source TEXT," +
    "living_area_range TEXT, approximate_age TEXT, public_remarks_full TEXT, photos_full TEXT)");
  const FRESH = new Date().toISOString();
  const ins = sqlite.prepare("INSERT INTO listings (listing_key, list_price, city, display_address," +
    " property_subtype, listing_url, brokerage_name, photos, last_updated, source," +
    " transaction_type, standard_status)" +
    " VALUES (?, ?, ?, ?, ?, '', 'B', '[]', ?, 'PROPTX', 'For Sale', 'Active')");
  for (const [k, p, c, t, a] of [...GAMED, ...REAL_CHEAP]) ins.run(k, p, c, a, t, FRESH);
  // A NULL-priced row: nothing this app shows a buyer can be computed from it.
  sqlite.prepare("INSERT INTO listings (listing_key, list_price, city, display_address," +
    " property_subtype, listing_url, brokerage_name, photos, last_updated, source," +
    " transaction_type, standard_status)" +
    " VALUES ('NULLP', NULL, 'Barrie', 'no price', 'Detached', '', 'B', '[]', ?, 'PROPTX', 'For Sale', 'Active')")
    .run(FRESH);

  const d1 = {
    prepare(sql) {
      let a = [];
      const st = {
        bind(...x) { a = x; return st; },
        async all() { return { results: sqlite.prepare(sql).all(...a) }; },
      };
      return st;
    },
  };

  // Every city that had a gamed listing, queried the way the route does.
  const gamedCities = [...new Set(GAMED.map((g) => g[2]))];
  let leaked = [];
  for (const city of gamedCities) {
    const rows = await db.getListingsByCity(d1, city === "Toronto C01" || city === "Toronto C03" ? "Toronto" : city, 100);
    leaked.push(...rows.filter((r) => Number(r.listPrice) < db.MIN_LISTING_PRICE));
  }
  check("no $1 listing is returned for any affected city",
    leaked.length === 0, leaked.map((l) => l.listingKey + "@" + l.listPrice).join(", "));

  // The listing that read "$6,401 cash to purchase" on its own detail page.
  const detail = await db.getListingByKey(d1, "G9");
  check("the detail page cannot serve a $1 listing either",
    detail === null, JSON.stringify(detail && detail.listPrice));

  const nullRow = await db.getListingByKey(d1, "NULLP");
  check("a listing with no price at all is not servable", nullRow === null);

  // --- 3. and the real inventory is untouched
  const collingwood = await db.getListingsByCity(d1, "Collingwood", 100);
  check("the $21,000 Collingwood condo is still shown (it is real inventory)",
    collingwood.some((r) => r.listingKey === "R1"),
    collingwood.map((r) => r.listingKey).join(","));
  const hamilton = await db.getListingsByCity(d1, "Hamilton", 100);
  check("Hamilton keeps its genuinely cheap real home and loses only the $1 one",
    hamilton.some((r) => r.listingKey === "R3") && !hamilton.some((r) => r.listingKey === "G9"),
    hamilton.map((r) => r.listingKey).join(","));
  const grandValley = await db.getListingsByCity(d1, "Grand Valley", 100);
  check("ordinary listings are completely unaffected",
    grandValley.length === 1 && grandValley[0].listingKey === "R5");

  // --- 4. the reason this mattered: what a buyer saw first
  const aurora = await db.getListingsByCity(d1, "Aurora", 100);
  check("Aurora's first result is no longer a $1 home",
    aurora.length === 0 || Number(aurora[0].listPrice) >= db.MIN_LISTING_PRICE,
    JSON.stringify(aurora.map((r) => r.listPrice)));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
})();
