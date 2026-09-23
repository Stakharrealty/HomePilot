// City coverage: every card the app shows can actually return listings.
//
// Before this, 4 of 49 HomePilot cities were ingested. The other 45 served a
// permanent empty state that looked exactly like "no listings match right
// now" and was in fact "this city has never been fetched". Nothing in the
// codebase could tell the two apart, which is why it went unnoticed for
// months -- so the first assertion here is the one that would have caught it:
// every public city name must resolve to something the ingest actually
// fetches.
//
// Two cities were recorded on 2026-09-18 as "genuine zero-coverage cities
// (not a naming issue)". Both were naming issues, confirmed live 2026-09-22:
//
//   Grand Valley  PropTx files it under the township's legal name,
//                 "East Luther Grand Valley" -- 46 active homes.
//   Ottawa        3,779 active homes under 51 district names that share no
//                 common prefix ("Barrhaven", "Kanata", "Orleans -
//                 Cumberland and Area"). The second-largest market in the
//                 feed after Toronto, serving zero. Reached via
//                 CountyOrParish, and filed under the Ottawa card by
//                 mapPropertyToRow.
//
// The capacity assertions at the end exist because the city list and the
// ingest tuning are one decision, not two: 47 cities at the old page size
// and time budget would take ~13h per pass against a 36h staleness cutoff,
// and listings would start disappearing from cities that had been working.
//
// Run: node --no-warnings tests/listings_city_coverage_test.js

const path = require("path");
const { pathToFileURL } = require("url");

const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
const load = (f) => import(pathToFileURL(path.join(SRC, f)).href);

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail ? " :: " + detail : "")); }
}

// Measured live against query.ampre.ca on 2026-09-22: every Active, For
// Sale, Residential listing across all 47 ingest targets.
const TOTAL_LISTINGS = 37791;
const CRON_INTERVAL_MS = 2 * 60 * 1000; // wrangler.jsonc: "*/2 * * * *"

(async () => {
  const cities = await load("cities.js");
  const auto = await load("proptx-auto-ingest.js");
  const ing = await load("proptx-ingest.js");
  const db = await load("db.js");
  const comm = await load("communities.js");

  const INGESTED = new Set(auto.AUTO_INGEST_CITIES);
  // How index.js turns a requested card name into the city rows are stored
  // under. Kept identical to the route on purpose.
  const resolve = (name) => cities.CITY_ALIASES[name] || name;

  // --- 1. the invariant that would have caught the original bug
  const unreachable = cities.PUBLIC_CITY_NAMES.filter((c) => !INGESTED.has(resolve(c)));
  check("every public city name resolves to a city the ingest fetches",
    unreachable.length === 0, unreachable.join(", "));
  check("all 49 HomePilot cities are covered",
    cities.HOMEPILOT_CITIES.length === 49 &&
    cities.HOMEPILOT_CITIES.every((c) => INGESTED.has(resolve(c))),
    cities.HOMEPILOT_CITIES.filter((c) => !INGESTED.has(resolve(c))).join(", "));
  check("the six Toronto sub-region cards all resolve to Toronto",
    cities.PUBLIC_CITY_NAMES.filter((c) => c.startsWith("Toronto - "))
      .every((c) => resolve(c) === "Toronto"));

  // --- 2. nothing is fetched that no card can ever show
  const orphans = auto.AUTO_INGEST_CITIES
    .filter((t) => !cities.PUBLIC_CITY_NAMES.some((c) => resolve(c) === t));
  check("no ingest target is fetched for a card that does not exist",
    orphans.length === 0, orphans.join(", "));

  // --- 3. Grand Valley: an alias, not zero coverage
  check("Grand Valley resolves to East Luther Grand Valley",
    resolve("Grand Valley") === "East Luther Grand Valley");
  check("East Luther Grand Valley is ingested", INGESTED.has("East Luther Grand Valley"));
  check("Grand Valley is matched as a plain city, needing no special case",
    db.cityMatchClause(resolve("Grand Valley")).sql === "city = ?");

  // --- 4. Ottawa: reached by county, filed under the Ottawa card
  const ottawaFilter = ing.buildCityFilter("Ottawa");
  check("Ottawa is filtered by CountyOrParish, not by City",
    ottawaFilter.includes("CountyOrParish eq 'Ottawa'") &&
    !ottawaFilter.includes("City eq 'Ottawa'"), ottawaFilter);
  check("Ottawa keeps the Active / For Sale / Residential filters",
    ["StandardStatus eq 'Active'", "TransactionType eq 'For Sale'", "startswith(PropertyType,'Residential')"]
      .every((x) => ottawaFilter.includes(x)));
  check("no other city is filtered by county",
    ["Hamilton", "Guelph", "Caledon", "East Luther Grand Valley"]
      .every((c) => !ing.buildCityFilter(c).includes("CountyOrParish")));

  const ottawaRow = (district) => ing.mapPropertyToRow({
    ListingKey: "K", ListPrice: 1, City: district, CityRegion: null,
    PropertySubType: "Detached", Media: [],
  }, "Ottawa");
  check("an Ottawa district row is filed under the Ottawa card",
    ottawaRow("Barrhaven").city === "Ottawa" && ottawaRow("Kanata").city === "Ottawa");
  check("the district is kept, not discarded",
    ottawaRow("Barrhaven").community === "Barrhaven" &&
    ottawaRow("Orleans - Cumberland and Area").community === "Orleans - Cumberland and Area");
  // The Ottawa rewrite must be opt-in per ingest target, never a rule about
  // the name "Barrhaven" -- otherwise a same-named place elsewhere in the
  // feed would silently be relabelled as Ottawa.
  check("the rewrite only applies to the Ottawa ingest target",
    ing.mapPropertyToRow({ ListingKey: "K", City: "Barrhaven", PropertySubType: "Detached", Media: [] }).city === "Barrhaven");
  check("/listings?city=Ottawa is an ordinary exact match",
    db.cityMatchClause("Ottawa").sql === "city = ?" &&
    db.cityMatchClause("Ottawa").binds[0] === "Ottawa");
  check("Ottawa has no community card, so it is never narrowed",
    comm.communitiesForCity("Ottawa") === null &&
    comm.cardForCommunity("Ottawa", "Barrhaven") === null);

  // --- 5. the payload trim that makes the bigger page size safe
  check("Media is expanded with a server-side filter, not pulled whole",
    ing.MEDIA_EXPAND.includes("$filter=") && ing.MEDIA_EXPAND.includes("ImageSizeDescription eq 'Large'"),
    ing.MEDIA_EXPAND);
  // Confirmed live: PropTx answers 200 with ZERO rows for a nested $select
  // rather than erroring, so this would fail silently and empty every city.
  check("the expansion never uses a nested $select, which PropTx silently drops",
    !ing.MEDIA_EXPAND.includes("$select"), ing.MEDIA_EXPAND);
  check("page size is PropTx's maximum of 100", ing.PAGE_SIZE === 100);

  // --- 6. capacity: the city list and the tuning are one decision
  const pages = Math.ceil(TOTAL_LISTINGS / ing.PAGE_SIZE);
  const runs = Math.ceil(pages / auto.MAX_PAGES_PER_RUN);
  const passHours = (runs * CRON_INTERVAL_MS) / 3600000;
  check("a full pass over every city fits well inside the refresh window",
    passHours < auto.REFRESH_AFTER_HOURS / 2,
    pages + " pages, " + runs + " runs, " + passHours.toFixed(1) + "h vs refresh " + auto.REFRESH_AFTER_HOURS + "h");
  // The bound that actually hides listings from buyers. A pass slower than
  // this does not just lag -- cities that were working go empty.
  check("a full pass finishes far inside the staleness cutoff",
    passHours * 2 < db.MAX_LISTING_AGE_HOURS,
    passHours.toFixed(1) + "h vs cutoff " + db.MAX_LISTING_AGE_HOURS + "h");
  // The budget is only checked BETWEEN pages, so a firing always overshoots
  // by however long its last page takes. It must still finish before the
  // next firing, or two runs end up sharing one city's cursor.
  //
  // A page measured ~1.3s against production. 30s is the allowance for a
  // genuinely bad one -- PropTx slow, a retry, a large batch write -- which
  // is a ~23x margin over the measurement, not a guess dressed up as one.
  const WORST_CASE_PAGE_MS = 30000;
  check("a firing plus a worst-case final page still ends before the next firing",
    auto.TIME_BUDGET_MS + WORST_CASE_PAGE_MS < CRON_INTERVAL_MS,
    auto.TIME_BUDGET_MS + "ms + " + WORST_CASE_PAGE_MS + "ms vs " + CRON_INTERVAL_MS + "ms interval");

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
})();
