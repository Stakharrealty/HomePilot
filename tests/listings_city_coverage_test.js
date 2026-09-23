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
const fs = require("fs");
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
  // A card is reachable two ways, and both are legitimate:
  //   1. its resolved name is an ingest target (most cards, and the aliased
  //      community cards, which then narrow by community)
  //   2. an ingest target stores rows UNDER the card name, because PropTx
  //      names that municipality differently (CITY_CARD_NAME: Grand Valley,
  //      Ottawa)
  const RENAMED_TO = new Set(Object.values(ing.CITY_CARD_NAME));
  const reachable = (card) => INGESTED.has(resolve(card)) || RENAMED_TO.has(card);

  // --- 1. the invariant that would have caught the original bug
  const unreachable = cities.PUBLIC_CITY_NAMES.filter((c) => !reachable(c));
  check("every public city name resolves to a city the ingest fetches",
    unreachable.length === 0, unreachable.join(", "));
  check("all 49 HomePilot cities are covered",
    cities.HOMEPILOT_CITIES.length === 49 && cities.HOMEPILOT_CITIES.every(reachable),
    cities.HOMEPILOT_CITIES.filter((c) => !reachable(c)).join(", "));
  check("the six Toronto sub-region cards all resolve to Toronto",
    cities.PUBLIC_CITY_NAMES.filter((c) => c.startsWith("Toronto - "))
      .every((c) => resolve(c) === "Toronto"));

  // --- 2. nothing is fetched that no card can ever show
  const orphans = auto.AUTO_INGEST_CITIES
    .filter((t) => !cities.PUBLIC_CITY_NAMES.some((c) => resolve(c) === t) && !ing.CITY_CARD_NAME[t]);
  check("no ingest target is fetched for a card that does not exist",
    orphans.length === 0, orphans.join(", "));

  // --- 3. Grand Valley: a rename handled at ingest, not an alias
  check("East Luther Grand Valley is ingested", INGESTED.has("East Luther Grand Valley"));
  check("its rows are stored under the card name the app knows",
    ing.CITY_CARD_NAME["East Luther Grand Valley"] === "Grand Valley");
  // The bug this replaced: as an ALIAS, rows landed under the legal name, which
  // is not a public city name and has no market record -- so cost math fell
  // through to the unknown-city defaults and the back link 400'd.
  check("Grand Valley is NOT an alias, so nothing stores the legal name",
    !cities.CITY_ALIASES["Grand Valley"] &&
    !cities.PUBLIC_CITY_NAMES.includes("East Luther Grand Valley"));
  check("Grand Valley is matched as a plain city, needing no special case",
    db.cityMatchClause(resolve("Grand Valley")).sql === "city = ?" &&
    db.cityMatchClause(resolve("Grand Valley")).binds[0] === "Grand Valley");

  // --- 3b. THE INVARIANT THAT WOULD HAVE CAUGHT THE GRAND VALLEY BUG
  //
  // Coverage is not enough. A card can be ingested and still be broken, if the
  // name that ends up in the city column is not a name the APP knows. Two
  // frontend modules read it directly and neither can resolve anything else:
  //   src/listing-fit.js:63   picks the market record by (cityRegion || city);
  //                           a miss silently uses the unknown-city defaults
  //                           (tax 0.0105, insurance 100) and renders them to
  //                           the buyer as this listing's real cost
  //   src/listing-detail.js   builds the back link as listings.html?city=<name>;
  //                           a name outside PUBLIC_CITY_NAMES makes /listings
  //                           answer 400 and the link is dead
  //
  // Grand Valley failed both for exactly one release: as an alias, rows landed
  // under "East Luther Grand Valley", which is neither.
  const appCitiesSrc = fs.readFileSync(path.join(__dirname, "..", "src", "cities.js"), "utf8");
  const marketNames = new Set(
    appCitiesSrc.split('n:"').slice(1).map((s) => s.slice(0, s.indexOf('"')))
  );
  check("parsed the app's market records", marketNames.size > 40, String(marketNames.size));

  // The name the frontend ends up using for a row returned under this card.
  const frontendName = (card) => {
    if (comm.CITY_COMMUNITIES[card]) return card;      // cityRegion = the card
    if (card.startsWith("Toronto - ")) return card;    // cityRegion = the card
    const target = resolve(card);
    return ing.CITY_CARD_NAME[target] || target;       // whatever ingest stored
  };
  // Plain "Toronto" is excluded: its rows are district-coded and regionForCity
  // maps every TRREB district onto one of the six sub-region cards, which
  // listings_toronto_hamilton_guelph_test.js asserts exhaustively.
  const cardsToCheck = cities.PUBLIC_CITY_NAMES.filter((c) => c !== "Toronto");

  const noMarketRecord = cardsToCheck.filter((c) => !marketNames.has(frontendName(c)));
  check("every card resolves to a market record the app actually has",
    noMarketRecord.length === 0,
    noMarketRecord.map((c) => c + " -> " + frontendName(c)).join(", "));

  const notRequestable = cardsToCheck.filter((c) => !cities.PUBLIC_CITY_NAMES.includes(frontendName(c)));
  check("every card's resolved name is one /listings would accept back (live back link)",
    notRequestable.length === 0,
    notRequestable.map((c) => c + " -> " + frontendName(c)).join(", "));

  // The two halves must agree. cityMatchClause binds resolve(card); the ingest
  // writes CITY_CARD_NAME[target] || target. An alias and a rename applied to
  // the SAME city would look correct in both checks above and still return
  // nothing at all, because the query would bind "East Luther Grand Valley"
  // while every row said "Grand Valley". That is a silent empty card, which is
  // the failure mode this whole file exists to make impossible.
  const storedNames = new Set(auto.AUTO_INGEST_CITIES.map((t) => ing.CITY_CARD_NAME[t] || t));
  const mismatched = cardsToCheck
    .filter((c) => resolve(c) !== "Toronto")
    .filter((c) => !storedNames.has(resolve(c)));
  check("what each card QUERIES is a name the ingest actually WRITES",
    mismatched.length === 0,
    mismatched.map((c) => c + " queries " + resolve(c)).join(", "));

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
  //
  // This block models the PESSIMISTIC case on purpose. An earlier version
  // computed runs as ceil(pages / MAX_PAGES_PER_RUN), which proved the claim
  // using the limiter the code itself says is NOT binding -- proptx-auto-ingest
  // states plainly that the budget, not the page cap, is what stops a firing.
  // Modelling the non-binding limiter flattered the result by roughly 5x.
  //
  // Per-page cost, from the only real production measurement: 580 pages in ~5h
  // at $top=25 is ~5.3s per page, of which ~2.0s was the fetch. That leaves
  // ~3.3s of non-fetch work (JSON parse, photo extraction, the batched D1
  // write) for 25 listings, or ~132ms per listing.
  //
  // At $top=100 the fetch measured 1.3s. If the non-fetch cost per listing did
  // not improve at all, a page costs 1.3 + 100*0.132 = ~14.5s. That is the
  // assumption used below, and it is deliberately unfair to the change: most of
  // that 132ms is parsing and walking Media, and MEDIA_EXPAND cuts the parsed
  // payload 4.7x and the media entries 5x, so the real figure should be well
  // under it. Better to assert the guarantee on the floor than on the hope.
  const PESSIMISTIC_PAGE_MS = 14500;
  const pages = Math.ceil(TOTAL_LISTINGS / ing.PAGE_SIZE);
  const pagesPerRun = Math.min(auto.MAX_PAGES_PER_RUN, Math.floor(auto.TIME_BUDGET_MS / PESSIMISTIC_PAGE_MS));
  check("a firing completes at least one page even at the pessimistic cost", pagesPerRun >= 1, String(pagesPerRun));
  const runs = Math.ceil(pages / pagesPerRun);
  const passHours = (runs * CRON_INTERVAL_MS) / 3600000;
  const detail = pages + " pages, " + pagesPerRun + "/run, " + runs + " runs, " + passHours.toFixed(1) + "h";
  check("a full pass over every city fits inside the refresh window",
    passHours < auto.REFRESH_AFTER_HOURS / 2,
    detail + " vs refresh " + auto.REFRESH_AFTER_HOURS + "h");
  // The bound that actually hides listings from buyers. A pass slower than
  // this does not just lag -- cities that were working go empty.
  check("a full pass finishes far inside the staleness cutoff",
    passHours * 2 < db.MAX_LISTING_AGE_HOURS,
    detail + " vs cutoff " + db.MAX_LISTING_AGE_HOURS + "h");
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

  // The CPU ceiling must sit ABOVE the wall-clock budget, so TIME_BUDGET_MS is
  // the only thing that ever stops a firing. If cpu_ms is the lower of the two,
  // a run gets killed by Error 1102 instead of finishing its budget -- and a
  // CPU kill is not a catchable exception, so it never reaches the error
  // accounting in runAutoIngest and never shows up in last_error. It would just
  // quietly throttle the ingest with nothing on the dashboard to say why.
  const wrangler = fs.readFileSync(
    path.join(__dirname, "..", "workers", "homepilot-listings", "wrangler.jsonc"), "utf8");
  const cpuMatch = wrangler.split('"cpu_ms"')[1];
  const cpuMs = cpuMatch ? parseInt(cpuMatch.replace(":", "").trim(), 10) : 0;
  check("the CPU ceiling is above the time budget, so the budget is the limiter",
    cpuMs > auto.TIME_BUDGET_MS,
    "cpu_ms " + cpuMs + " vs TIME_BUDGET_MS " + auto.TIME_BUDGET_MS);

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
})();
