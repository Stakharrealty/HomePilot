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
  check("every ingested city is a known HomePilot city", list.every((c) => cities.HOMEPILOT_CITIES.includes(c)));

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
  check("plain Toronto: no city bind (limit, offset only)", JSON.stringify(c1[0].args) === "[20,0]", JSON.stringify(c1[0].args));
  const c2 = []; await db.getListingsByCity(fakeD1(c2), "Toronto", 20, "condo", 0, 800000, dist.districtsForRegion("Toronto - Downtown"));
  check("Toronto sub-region: adds city_district IN ('C01',...)", /city_district IN \('C01', 'C02', 'C08', 'C09', 'C10'\)/.test(c2[0].sql), c2[0].sql);
  check("Toronto sub-region: binds are budget*1.10, limit, offset", c2[0].args.length === 3 && Math.abs(c2[0].args[0] - 880000) < 0.01 && c2[0].args[1] === 20, JSON.stringify(c2[0].args));
  const c3 = []; await db.getListingsByCity(fakeD1(c3), "Hamilton", 20, null, 0, null);
  check("Hamilton: plain city = ? with the city bound first", /WHERE city = \? AND/.test(c3[0].sql) && c3[0].args[0] === "Hamilton");
  check("non-Toronto query has no LIKE", !/LIKE 'Toronto/.test(c3[0].sql));
  check("Toronto query still applies the PROPTX / For Sale / homes-only filters", /source = 'PROPTX'/.test(c1[0].sql) && /transaction_type = 'For Sale'/.test(c1[0].sql) && c1[0].sql.includes(db.SHOWN_HOMES_CLAUSE));
  let threw = false; try { db.cityMatchClause("Toronto", ["C01'; DROP TABLE listings;--"]); } catch { threw = true; }
  check("SQL injection through a district code is rejected", threw);

  const idx = fs.readFileSync(path.join(SRC, "index.js"), "utf8");
  check("index.js passes the sub-region districts into the query", /districtsForRegion\(requestedCity\)/.test(idx) && /searchBudget, torontoDistricts\)/.test(idx));
  check("ingest-status endpoint counts Toronto via cityMatchClause", idx.includes("cityMatchClause(city)"));

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
