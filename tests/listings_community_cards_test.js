// Community cards: Acton, Georgetown, King City, Bradford.
//
// These four HomePilot cards are not municipalities. PropTx stores them
// under the municipality that contains them -- Halton Hills, King, Bradford
// West Gwillimbury -- and names the community only in CityRegion. Two
// separate things had to be true for the cards to work, and neither was:
//
//   1. the municipality has to be ingested at all (it wasn't, so the cards
//      were permanently empty -- not "no listings right now", but none ever)
//   2. the card has to narrow back down to its own community (or an Acton
//      card shows all 263 Halton Hills listings, 140 of them Georgetown,
//      and a King City card prices Schomberg homes as King City)
//
// Seed data below is the REAL live distribution, confirmed 2026-09-22
// against query.ampre.ca over every Active / For Sale / Residential listing
// in the three municipalities (689 listings, CityRegion populated on 100%).
//
// Why real SQLite: the community narrowing is SQL. node:sqlite runs the
// exact string getListingsByCity sends to D1, so a test that passes here
// cannot pass while the real query fails.
//
// Run: node --no-warnings tests/listings_community_cards_test.js

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
const load = (f) => import(pathToFileURL(path.join(SRC, f)).href);

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail ? " :: " + detail : "")); }
}

// The real feed, exactly as it came back: [municipality, raw CityRegion, count].
const LIVE = [
  ["Halton Hills", "Georgetown", 140],
  ["Halton Hills", "1049 - Rural Halton Hills", 69],
  ["Halton Hills", "1045 - AC Acton", 28],
  ["Halton Hills", "1064 - ES Rural Esquesing", 11],
  ["Halton Hills", "Glen Williams", 10],
  ["Halton Hills", "1048 - Limehouse", 3],
  ["Halton Hills", "1050 - Stewarttown", 2],
  ["King", "King City", 98],
  ["King", "Rural King", 73],
  ["King", "Nobleton", 37],
  ["King", "Schomberg", 24],
  ["King", "Pottageville", 11],
  ["Bradford West Gwillimbury", "Bradford", 137],
  ["Bradford West Gwillimbury", "Rural Bradford West Gwillimbury", 36],
  ["Bradford West Gwillimbury", "Bond Head", 10],
];

const INJECTION = "Acton" + String.fromCharCode(39) + "; DROP TABLE listings;--";

(async () => {
  const comm = await load("communities.js");
  const db = await load("db.js");
  const cities = await load("cities.js");
  const ing = await load("proptx-ingest.js");

  // --- 1. the normalizer, against every real value the feed actually sends
  const NORM = {
    "Georgetown": "Georgetown",
    "1049 - Rural Halton Hills": "Rural Halton Hills",
    "1045 - AC Acton": "Acton",
    "1064 - ES Rural Esquesing": "Rural Esquesing",
    "Glen Williams": "Glen Williams",
    "1048 - Limehouse": "Limehouse",
    "1050 - Stewarttown": "Stewarttown",
    "King City": "King City",
    "Rural King": "Rural King",
    "Nobleton": "Nobleton",
    "Schomberg": "Schomberg",
    "Pottageville": "Pottageville",
    "Bradford": "Bradford",
    "Rural Bradford West Gwillimbury": "Rural Bradford West Gwillimbury",
    "Bond Head": "Bond Head",
  };
  const wrong = Object.entries(NORM).filter(([raw, want]) => comm.normalizeCommunity(raw) !== want);
  check("normalizeCommunity handles all 15 real CityRegion values", wrong.length === 0,
    wrong.map(([r]) => r + " -> " + comm.normalizeCommunity(r)).join(" | "));
  check("the two coded shapes both reduce to the bare name",
    comm.normalizeCommunity("1045 - AC Acton") === "Acton" &&
    comm.normalizeCommunity("1064 - ES Rural Esquesing") === "Rural Esquesing");
  check("junk in, null out",
    [null, undefined, "", "   ", 42].every((v) => comm.normalizeCommunity(v) === null));

  // --- 2. the card table agrees with the aliases it depends on
  for (const card of Object.keys(comm.CITY_COMMUNITIES)) {
    check(card + ": alias and municipality table agree",
      cities.CITY_ALIASES[card] === comm.COMMUNITY_MUNICIPALITY[card],
      cities.CITY_ALIASES[card] + " vs " + comm.COMMUNITY_MUNICIPALITY[card]);
    check(card + ": is a city the app actually shows",
      cities.HOMEPILOT_CITIES.includes(card) && cities.PUBLIC_CITY_NAMES.includes(card));
  }
  check("only community cards are community-scoped",
    comm.communitiesForCity("Halton Hills") === null &&
    comm.communitiesForCity("Hamilton") === null &&
    comm.communitiesForCity("Toronto") === null &&
    comm.communitiesForCity("Toronto - Downtown") === null);
  check("Halton Hills is its own card and keeps the whole municipality",
    cities.HOMEPILOT_CITIES.includes("Halton Hills") && !("Halton Hills" in comm.CITY_COMMUNITIES));

  // --- 3. cardForCommunity is scoped, and does not match on substrings
  check("Halton Hills + Acton -> the Acton card",
    comm.cardForCommunity("Halton Hills", "Acton") === "Acton");
  check("a rural row that merely CONTAINS the card name is not that card",
    comm.cardForCommunity("Bradford West Gwillimbury", "Rural Bradford West Gwillimbury") === null);
  check("a community is never matched against another municipality's card",
    comm.cardForCommunity("King", "Bradford") === null &&
    comm.cardForCommunity("Halton Hills", "King City") === null);
  check("hamlets with their own names belong to no community card",
    ["Glen Williams", "Limehouse", "Stewarttown", "Rural Halton Hills"]
      .every((c) => comm.cardForCommunity("Halton Hills", c) === null));

  // --- 4. the SQL: bound, never inlined
  const m = db.cityMatchClause("Halton Hills", null, ["Acton"]);
  check("community narrowing is a bound placeholder, not an inlined literal",
    m.sql.includes("community IN (?)") && !m.sql.includes("Acton"), m.sql);
  check("binds are city first, then the communities, in placeholder order",
    JSON.stringify(m.binds) === JSON.stringify(["Halton Hills", "Acton"]), JSON.stringify(m.binds));
  const evil = db.cityMatchClause("Halton Hills", null, [INJECTION]);
  check("a hostile community value goes to the binds, never the SQL",
    !evil.sql.includes("DROP") && evil.binds.includes(INJECTION));
  check("no communities means no extra clause (Hamilton is unchanged)",
    db.cityMatchClause("Hamilton").sql === "city = ?" &&
    !db.cityMatchClause("Hamilton").sql.includes("community"));
  check("Toronto district matching still works alongside",
    db.cityMatchClause("Toronto", ["C01"]).sql.includes("city_district IN"));

  // --- 5. the ingest asks for it and stores it
  const srcText = fs.readFileSync(path.join(SRC, "proptx-ingest.js"), "utf8");
  check("CityRegion is in the PropTx $select field list", srcText.includes("CityRegion"));
  const row = (city, region) => ing.mapPropertyToRow({
    ListingKey: "K", ListPrice: 1, City: city, CityRegion: region,
    PropertySubType: "Detached", Media: [],
  });
  check("a row stores the NORMALIZED community",
    row("Halton Hills", "1045 - AC Acton").community === "Acton");
  check("a bare community is stored as-is", row("King", "King City").community === "King City");
  check("a row with no CityRegion stores NULL, not a guess",
    row("Hamilton", undefined).community === null);
  check("the municipality still goes in city, untouched",
    row("Halton Hills", "1045 - AC Acton").city === "Halton Hills");

  // --- 6. end to end, real SQLite, real live distribution
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
    "living_area_range TEXT, approximate_age TEXT)");
  const FRESH = new Date().toISOString();
  const ins = sqlite.prepare("INSERT INTO listings (listing_key, list_price, city, community," +
    " listing_url, brokerage_name, photos, last_updated, property_subtype, source," +
    " transaction_type, standard_status)" +
    " VALUES (?, 800000, ?, ?, '', 'B', '[]', ?, 'Detached', 'PROPTX', 'For Sale', 'Active')");
  let seq = 0;
  sqlite.exec("BEGIN");
  for (const [city, raw, count] of LIVE) {
    const community = comm.normalizeCommunity(raw);
    for (let i = 0; i < count; i++) ins.run("K" + seq++, city, community, FRESH);
  }
  sqlite.exec("COMMIT");
  check("seeded all 689 live listings", seq === 689, String(seq));

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
  // Exactly how index.js resolves a card: alias to the municipality, then narrow.
  const card = (name) => db.getListingsByCity(
    d1, cities.CITY_ALIASES[name] || name, 1000, null, 0, null, null, comm.communitiesForCity(name));

  const acton = await card("Acton");
  const georgetown = await card("Georgetown");
  const haltonHills = await card("Halton Hills");
  const kingCity = await card("King City");
  const bradford = await card("Bradford");

  check("Acton shows its own 28 listings", acton.length === 28, String(acton.length));
  check("Georgetown shows its own 140", georgetown.length === 140, String(georgetown.length));
  check("King City shows 98, not all 243 of King township", kingCity.length === 98, String(kingCity.length));
  check("Bradford shows 137, excluding the 36 rural and 10 Bond Head", bradford.length === 137, String(bradford.length));
  check("Halton Hills, a real municipality card, still shows all 263", haltonHills.length === 263, String(haltonHills.length));

  // The actual bug, stated as a test: without the narrowing, Acton IS Halton Hills.
  const unfiltered = await db.getListingsByCity(d1, "Halton Hills", 1000, null, 0, null, null, null);
  check("the narrowing is what makes Acton differ from its municipality",
    unfiltered.length === 263 && acton.length !== unfiltered.length);
  const gKeys = new Set(georgetown.map((l) => l.listingKey));
  check("Acton and Georgetown are not the same list",
    acton.length !== georgetown.length && acton.every((l) => !gKeys.has(l.listingKey)));
  check("no card leaks a rural or neighbouring-hamlet listing",
    [[acton, "Acton"], [georgetown, "Georgetown"], [kingCity, "King City"], [bradford, "Bradford"]]
      .every(([list, name]) => list.every((l) => l.cityRegion === name)));

  // --- 7. the card name reaches the frontend, so cost math uses the right market
  check("an Acton listing reports cityRegion 'Acton' for the cost engine",
    acton.length > 0 && acton.every((l) => l.cityRegion === "Acton"),
    JSON.stringify(acton[0] && acton[0].cityRegion));
  check("a King City listing reports 'King City', not 'King' (the app has no King record)",
    kingCity.every((l) => l.cityRegion === "King City"));
  check("a Halton Hills listing outside Acton/Georgetown reports no card name, so it falls back to its city",
    haltonHills.filter((l) => l.cityRegion === null).length === 263 - 28 - 140);

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
})();
