// Hamilton / Guelph / Toronto rollout: ingest city list + filters, Toronto
// district mapping, Toronto read query, and an ingest-capacity sanity check.
// Pure module tests (no server, no network, no real D1).
const path = require("path");
const { pathToFileURL } = require("url");
const fs = require("fs");
const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
const load = (f) => import(pathToFileURL(path.join(SRC, f)).href);
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}

(async () => {
  const auto = await load("proptx-auto-ingest.js");
  const ing = await load("proptx-ingest.js");
  const dist = await load("toronto-districts.js");
  const db = await load("db.js");
  const cities = await load("cities.js");

  // --- ingest city list
  const list = auto.AUTO_INGEST_CITIES;
  check("Mississauga, Hamilton, Guelph, Toronto are all ingested", ["Mississauga", "Hamilton", "Guelph", "Toronto"].every((c) => list.includes(c)), list.join());
  check("Toronto is last, so its refresh can't starve the small cities", list[list.length - 1] === "Toronto");
  // An ingested name is either a city the app shows, or a PropTx MUNICIPALITY
  // that a shown city resolves to through CITY_ALIASES ("Halton Hills" carries
  // the Acton and Georgetown cards, "King" carries King City, "Bradford West
  // Gwillimbury" carries Bradford). Anything else is a typo that would ingest
  // nothing and go unnoticed.
  const aliasTargets = new Set(Object.values(cities.CITY_ALIASES));
  // A third legitimate route, added with the full-coverage rollout: an ingest
  // target whose rows are STORED under a different card name, because PropTx
  // uses a municipality's legal name the app does not ("East Luther Grand
  // Valley" -> the Grand Valley card). See CITY_CARD_NAME in proptx-ingest.js.
  const renamed = await load("proptx-ingest.js");
  const earnsItsPlace = (c) =>
    cities.HOMEPILOT_CITIES.includes(c) || aliasTargets.has(c) || !!renamed.CITY_CARD_NAME[c];
  check("every ingested city is a HomePilot city, an alias target, or a rename source",
    list.every(earnsItsPlace), list.filter((c) => !earnsItsPlace(c)).join());
  // The regression this rollout exists to prevent: a card aliased to a
  // municipality nobody ingests is not "empty right now", it is empty forever.
  const comms = await load("communities.js");
  for (const card of Object.keys(comms.CITY_COMMUNITIES)) {
    const muni = cities.CITY_ALIASES[card];
    check(card + " resolves to " + muni + ", which is actually ingested", list.includes(muni));
  }

  // --- ingest filters
  const dec = (c) => decodeURIComponent(ing.buildCityFilter(c));
  check("Hamilton: exact City match", dec("Hamilton").includes("City eq 'Hamilton'") && !dec("Hamilton").includes("startswith(City"));
  check("Guelph: exact City match", dec("Guelph").includes("City eq 'Guelph'"));
  check("Toronto: startswith(City,'Toronto'), no exact match", dec("Toronto").includes("startswith(City,'Toronto')") && !dec("Toronto").includes("City eq 'Toronto'"));
  check("Toronto keeps the For Sale / Active / Residential filters",
    ["StandardStatus eq 'Active'", "TransactionType eq 'For Sale'", "startswith(PropertyType,'Residential')"].every((x) => dec("Toronto").includes(x)));
  check("Mississauga filter unchanged (exact)", dec("Mississauga").includes("City eq 'Mississauga'"));

  // --- row mapping
  const row = (city) => ing.mapPropertyToRow({ ListingKey: "K", ListPrice: 1, City: city, PropertySubType: "Detached", Media: [] });
  check("Toronto C07 row stores full city and district C07", row("Toronto C07").city === "Toronto C07" && row("Toronto C07").city_district === "C07");
  check("Toronto W04 row -> district W04", row("Toronto W04").city_district === "W04");
  check("non-Toronto row has NULL city_district", row("Hamilton").city_district === null && row("Guelph").city_district === null);

  // --- district mapping
  const regions = dist.TORONTO_REGION_DISTRICTS;
  const aliasNames = Object.keys(cities.CITY_ALIASES).filter((k) => k.startsWith("Toronto - ")).sort();
  check("six sub-region cards, matching CITY_ALIASES exactly", JSON.stringify(Object.keys(regions).sort()) === JSON.stringify(aliasNames), Object.keys(regions).join());
  const all = Object.values(regions).flat();
  check("no district is assigned to two cards", new Set(all).size === all.length);
  const trreb = [];
  for (let i = 1; i <= 15; i++) if (i !== 5) trreb.push("C" + String(i).padStart(2, "0"));
  for (let i = 1; i <= 11; i++) trreb.push("E" + String(i).padStart(2, "0"));
  for (let i = 1; i <= 10; i++) trreb.push("W" + String(i).padStart(2, "0"));
  const missing = trreb.filter((c) => !all.includes(c));
  check("every TRREB district (C01-C15 excl. C05, E01-E11, W01-W10) is mapped", missing.length === 0, missing.join());
  check("no unknown codes in the table", all.every((c) => trreb.includes(c)));
  const spot = { C01: "Toronto - Downtown", C07: "Toronto - North York", W06: "Toronto - Etobicoke", E05: "Toronto - Scarborough", W01: "Toronto - West End", E01: "Toronto - East End" };
  check("spot checks (C01 downtown, C07 North York, W06 Etobicoke, E05 Scarborough, W01 West End, E01 East End)",
    Object.entries(spot).every(([code, name]) => regions[name].includes(code)));
  check("districtsForRegion: card -> codes, plain Toronto / others -> null",
    dist.districtsForRegion("Toronto - Downtown").includes("C01") && dist.districtsForRegion("Toronto") === null && dist.districtsForRegion("Hamilton") === null);
  check("parseTorontoDistrict handles junk", dist.parseTorontoDistrict("Toronto") === null && dist.parseTorontoDistrict(null) === null && dist.parseTorontoDistrict("Toronto C7") === null);

  // --- read query
  function fakeD1(calls) {
    return { prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return { all: async () => ({ results: [] }) }; } }; } };
  }
  const c1 = []; await db.getListingsByCity(fakeD1(c1), "Toronto", 20, null, 0, null);
  check("plain Toronto: matches district-coded rows via LIKE 'Toronto %'", /\(city = 'Toronto' OR city LIKE 'Toronto %'\)/.test(c1[0].sql), c1[0].sql);
  // Bind order (2026-09-22): the freshness cutoff sits between the city binds
  // and limit/offset — see VISIBLE_LISTING_CLAUSE in db.js. Plain Toronto has
  // no city bind at all (it matches via a LIKE literal), so the cutoff is first.
  check("plain Toronto: no city bind; binds are cutoff, limit, offset",
    c1[0].args.length === 3 && typeof c1[0].args[0] === "string" && c1[0].args[1] === 20 && c1[0].args[2] === 0,
    JSON.stringify(c1[0].args));
  check("plain Toronto: the freshness cutoff is a real ISO timestamp in the past",
    !Number.isNaN(Date.parse(c1[0].args[0])) && Date.parse(c1[0].args[0]) < Date.now(), c1[0].args[0]);
  const c2 = []; await db.getListingsByCity(fakeD1(c2), "Toronto", 20, "condo", 0, 800000, dist.districtsForRegion("Toronto - Downtown"));
  check("Toronto sub-region: adds city_district IN ('C01',...)", /city_district IN \('C01', 'C02', 'C08', 'C09', 'C10'\)/.test(c2[0].sql), c2[0].sql);
  check("Toronto sub-region: binds are cutoff, budget*1.10, limit, offset",
    c2[0].args.length === 4 && typeof c2[0].args[0] === "string"
    && Math.abs(c2[0].args[1] - 880000) < 0.01 && c2[0].args[2] === 20 && c2[0].args[3] === 0,
    JSON.stringify(c2[0].args));
  const c3 = []; await db.getListingsByCity(fakeD1(c3), "Hamilton", 20, null, 0, null);
  check("Hamilton: plain city = ? with the city bound first", /WHERE city = \? AND/.test(c3[0].sql) && c3[0].args[0] === "Hamilton");
  check("non-Toronto query has no LIKE", !/LIKE 'Toronto/.test(c3[0].sql));
  check("Toronto query still applies the PROPTX / For Sale / homes-only filters", /source = 'PROPTX'/.test(c1[0].sql) && /transaction_type = 'For Sale'/.test(c1[0].sql) && c1[0].sql.includes(db.SHOWN_HOMES_CLAUSE));
  let threw = false; try { db.cityMatchClause("Toronto", ["C01'; DROP TABLE listings;--"]); } catch { threw = true; }
  check("SQL injection through a district code is rejected", threw);

  const idx = fs.readFileSync(path.join(SRC, "index.js"), "utf8");
  check("index.js passes the sub-region districts into the query", /districtsForRegion\(requestedCity\)/.test(idx) && /searchBudget, torontoDistricts, communities\)/.test(idx));
  check("index.js passes the community narrowing into the query too",
    idx.includes("communitiesForCity(requestedCity)") && idx.includes("torontoDistricts, communities)"));
  // The ingest-status route that used to call cityMatchClause(city) was one of
  // the six unauthenticated diagnostic routes removed on 2026-09-22. What still
  // matters is that cityMatchClause remains the single place Toronto matching
  // is defined, and that it is no longer reachable without authentication.
  check("cityMatchClause is still the one place Toronto matching is defined",
    typeof db.cityMatchClause === "function" && /city LIKE .Toronto %./.test(db.cityMatchClause("Toronto").sql));
  check("the removed diagnostic routes are not back",
    !idx.includes('url.pathname === "/proptx-ingest-status"'));

  // --- capacity model. Measured: Mississauga took 95 pages (25 listings each)
  // in ~20 min on the 2-minute cron, i.e. ~10 pages per firing. Assume only
  // HALF that for Toronto (bigger cursor URLs, more photos).
  const PAGE = 25, PAGES_PER_RUN = 5, RUNS_PER_DAY = 720;
  const need = { Mississauga: 2350, Hamilton: 2500, Guelph: 700, Toronto: 20656 };
  const pagesPerCycle = Object.values(need).reduce((a, v) => a + Math.ceil(v / PAGE), 0);
  const hoursPerCycle = pagesPerCycle / PAGES_PER_RUN * 2 / 60;
  check(`one full cycle of all four cities (~${pagesPerCycle} pages) finishes in ${hoursPerCycle.toFixed(1)}h, well inside 24h`, hoursPerCycle < 12, hoursPerCycle.toFixed(1));
  check("a city restarts 12h after finishing, so worst-case age stays under 24h", auto.REFRESH_AFTER_HOURS + hoursPerCycle < 24, String(auto.REFRESH_AFTER_HOURS + hoursPerCycle));
  check("daily page budget is >= 3x the pages one refresh needs", RUNS_PER_DAY * PAGES_PER_RUN >= 3 * pagesPerCycle);

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
