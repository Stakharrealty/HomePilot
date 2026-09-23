// Affordability-consistency fix test (2026-07-29).
//
// Background: the listings page had NO price ceiling at all -- a buyer
// could be shown "Detached: $900,000 recommended" and then see $1.5M
// listings under "View Homes" for that same card. Fix: listings above
// searchBudget * STRETCH_MULTIPLIER (1.10, matching the SAME stretch
// tolerance already used on the main results page) are now excluded
// server-side, and every listing at/under that ceiling gets a visible
// fit-tier badge (getFit(): Great fit / Good Fit / Stretch, see listing-fit.js) -- never silently mixed.
//
// Why real SQLite (node:sqlite), not a mocked D1 stub: the price-ceiling
// clause changes db.js's bind() from a fixed 3-arg call to a dynamically-
// built positional array (city, [budget], limit, offset) -- exactly the
// kind of change where a silent off-by-one bind error is easy to introduce
// and impossible to catch with a stub that just records what was passed,
// rather than actually executing the SQL and checking real results.
//
// Run: node --no-warnings tests/listings_affordability_budget_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

async function main() {
  const dbSrc = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");

  // --- 1. STRETCH_MULTIPLIER exists and is exactly 1.10 ---
  const multiplierMatch = dbSrc.match(/const STRETCH_MULTIPLIER = ([\d.]+);/);
  check("STRETCH_MULTIPLIER constant exists in db.js", !!multiplierMatch);
  check("STRETCH_MULTIPLIER is exactly 1.10", multiplierMatch && parseFloat(multiplierMatch[1]) === 1.10);

  // --- 2. render.js uses the SAME 1.10 value elsewhere in the app ---
  const renderSrc = fs.readFileSync(path.join(__dirname, "..", "src", "render.js"), "utf8");
  check(
    "render.js's existing stretch tolerance (buyPower*1.10) matches db.js's STRETCH_MULTIPLIER",
    /buyPower\s*\*\s*1\.10/.test(renderSrc)
  );

  // --- 3. render.js: both "View Homes" buttons pass a price/budget as the
  //     3rd argument to openListingsWindow ---
  check(
    "City-level 'View All Homes' button passes displayPrice as 3rd arg to openListingsWindow",
    renderSrc.includes("openListingsWindow(\\''+x.n+'\\',\\''+activeProp+'\\','+displayPrice+')")
  );
  check(
    "Property-type card button passes price (the card's own displayed number) as 3rd arg",
    renderSrc.includes("openListingsWindow(\\''+cityName+'\\',\\''+tp+'\\','+price+')")
  );

  // --- 4. db.js: getListingsByCity accepts searchBudget and builds the
  //     price-ceiling clause correctly ---
  const dbModule = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  check("getListingsByCity is exported", typeof dbModule.getListingsByCity === "function");

  function makeFakeD1(capturedCalls) {
    return {
      prepare(sql) {
        return {
          bind(...args) {
            capturedCalls.push({ sql, args });
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    };
  }

  const calls1 = [];
  await dbModule.getListingsByCity(makeFakeD1(calls1), "Mississauga", 24, "detached", 0, 900000);
  const sql1 = calls1[0].sql;
  const args1 = calls1[0].args;
  check("with searchBudget: SQL includes 'AND list_price <= ?'", /AND list_price <= \?/.test(sql1), sql1);
  // Bind order gained a freshness cutoff between the city and the budget on
  // 2026-09-22 (VISIBLE_LISTING_CLAUSE in db.js). Order still matters
  // absolutely: D1 binds positionally and silently returns the wrong rows if
  // it is wrong.
  check(
    "with searchBudget: bind args are in correct positional order (city, cutoff, budget*1.10, limit, offset)",
    args1.length === 5 && args1[0] === "Mississauga" && typeof args1[1] === "string"
      && Math.abs(args1[2] - 990000) < 0.001 && args1[3] === 24 && args1[4] === 0,
    JSON.stringify(args1)
  );
  check(
    "the freshness cutoff bind is a real ISO timestamp in the past",
    !Number.isNaN(Date.parse(args1[1])) && Date.parse(args1[1]) < Date.now(),
    String(args1[1])
  );

  const calls2 = [];
  await dbModule.getListingsByCity(makeFakeD1(calls2), "Mississauga", 24, "detached", 0, null);
  const sql2 = calls2[0].sql;
  const args2 = calls2[0].args;
  check("WITHOUT searchBudget: SQL does NOT include a price clause", !/list_price <=/.test(sql2), sql2);
  check(
    "WITHOUT searchBudget: bind args are city, cutoff, limit, offset (no budget bind)",
    args2.length === 4 && args2[0] === "Mississauga" && typeof args2[1] === "string"
      && args2[2] === 24 && args2[3] === 0,
    JSON.stringify(args2)
  );

  for (const invalid of [0, -100, NaN, "not a number", undefined]) {
    const calls = [];
    await dbModule.getListingsByCity(makeFakeD1(calls), "Toronto", 24, null, 0, invalid);
    check(
      `invalid searchBudget (${JSON.stringify(invalid)}) is treated as no budget filter`,
      !/list_price <=/.test(calls[0].sql),
      calls[0].sql
    );
  }

  // --- 5. Real SQLite execution: the price ceiling actually filters
  //     correctly, including exact boundary behavior ---
  // Updated 2026-09-18: PROPERTY_TYPE_FILTERS is now built from
  // home-types.js (PropTx property_subtype) instead of written as literal
  // DDF clauses, so the detached clause is read from the exported object
  // rather than regex-extracted from source.
  const detachedClause = dbModule.PROPERTY_TYPE_FILTERS.detached;
  check("detached clause available from db.js export", typeof detachedClause === "string" && detachedClause.length > 0);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE listings (
    listing_key TEXT PRIMARY KEY,
    list_price INTEGER,
    property_subtype TEXT
  )`);
  const insert = db.prepare(
    "INSERT INTO listings (listing_key, list_price, property_subtype) VALUES (?, ?, ?)"
  );
  const boundaryListings = [
    { key: "L_under", price: 850000 },
    { key: "L_at_budget", price: 900000 },
    { key: "L_in_stretch", price: 950000 },
    { key: "L_at_ceiling", price: 990000 },
    { key: "L_over_ceiling", price: 990001 },
    { key: "L_way_over", price: 1500000 },
  ];
  for (const l of boundaryListings) {
    insert.run(l.key, l.price, "Detached");
  }

  const budget = 900000;
  const ceiling = budget * 1.10;
  const rows = db.prepare(
    `SELECT listing_key, list_price FROM listings WHERE (${detachedClause}) AND list_price <= ? ORDER BY list_price ASC`
  ).all(ceiling);
  const returnedKeys = rows.map((r) => r.listing_key);

  check("boundary: listing under budget is included", returnedKeys.includes("L_under"));
  check("boundary: listing exactly AT budget is included", returnedKeys.includes("L_at_budget"));
  check("boundary: listing in the stretch range is included", returnedKeys.includes("L_in_stretch"));
  check("boundary: listing exactly AT the 10% ceiling is included (<=, not <)", returnedKeys.includes("L_at_ceiling"));
  check("boundary: listing $1 over the ceiling is EXCLUDED", !returnedKeys.includes("L_over_ceiling"));
  check("boundary: listing way over budget is EXCLUDED", !returnedKeys.includes("L_way_over"));
  check("exactly 4 of 6 boundary listings returned", returnedKeys.length === 4, JSON.stringify(returnedKeys));

  // --- 6. Badge logic (changed by product decision): the 10% price ceiling is
  // still the hard wall, applied first; for a listing inside it the badge is
  // now getFit()'s cost-vs-take-home tier, not a price-vs-budget comparison.
  // The full behaviour (three tiers, ceiling, cards == detail page) is
  // exercised for real in tests/listing_detail_page_test.js; here we pin the
  // constants that must never drift apart. ---
  const fitSrc = fs.readFileSync(path.join(__dirname, "..", "src", "listing-fit.js"), "utf8");
  check("server-side STRETCH_MULTIPLIER is still 1.10 (the actual price wall)", /const STRETCH_MULTIPLIER = 1\.10;/.test(dbSrc));
  check("client-side LD_STRETCH_MULTIPLIER is still 1.10 (same ceiling)", /const LD_STRETCH_MULTIPLIER = 1\.10;/.test(fitSrc));
  check("ceiling is checked BEFORE getFit() (past it: no badge)", fitSrc.indexOf("price > b * LD_STRETCH_MULTIPLIER") > -1 && fitSrc.indexOf("price > b * LD_STRETCH_MULTIPLIER") < fitSrc.indexOf("getFit(computed.costs.total"));

  // --- 7. index.js: /listings route parses and validates the budget param ---
  check("index.js parses 'budget' query param", /searchParams\.get\("budget"\)/.test(indexSrc));
  check(
    "index.js validates budget as finite and positive before use",
    /Number\.isFinite\(budgetParam\)\s*&&\s*budgetParam\s*>\s*0/.test(indexSrc)
  );
  // Updated 2026-09-18: the route now passes cappedLimit (PropTx Article
  // 6.3(b), 100 per search) instead of the raw limit.
  check("index.js passes searchBudget into getListingsByCity", /getListingsByCity\(env\.DB, city, cappedLimit, propertyType, offset, searchBudget, torontoDistricts\)/.test(indexSrc));

  // --- 8. listings-display.js: fetchListings/openListingsWindow wiring ---
  const displaySrc = fs.readFileSync(path.join(__dirname, "..", "src", "listings-display.js"), "utf8");
  check(
    "fetchListings sets 'budget' param only when searchBudget is valid",
    /params\.set\("budget", String\(searchBudget\)\)/.test(displaySrc)
  );
  check(
    "openListingsWindow includes budget in the listings.html URL only when valid",
    /paramsObj\.budget = String\(searchBudget\)/.test(displaySrc)
  );
  check(
    "renderListingCard gets its badge from listingFit(listing, profile, searchBudget) (getFit tier)",
    /listingFit\(listing, loadBuyerProfile\(\), searchBudget\)/.test(displaySrc)
  );
  check("the old price-vs-budget within/stretch comparison is gone", !/listing\.listPrice <= searchBudget/.test(displaySrc) && !/Within Budget|Stretch Option/.test(displaySrc));

  // --- 9. listings.html: reads budget from URL and passes it through ---
  const listingsHtmlSrc = fs.readFileSync(path.join(__dirname, "..", "listings.html"), "utf8");
  check("listings.html parses 'budget' from URL query params", /params\.get\("budget"\)/.test(listingsHtmlSrc));
  check(
    "listings.html passes searchBudget into renderLiveListings",
    /renderLiveListings\(city, root, propertyType, searchBudget\)/.test(listingsHtmlSrc)
  );

  // --- 10. CSS: badge classes exist in all 3 pages that load listings-display.js ---
  for (const htmlFile of ["listings.html", "index.html", "calculator.html", "listing.html"]) {
    const htmlSrc = fs.readFileSync(path.join(__dirname, "..", htmlFile), "utf8");
    check(
      `${htmlFile} defines the three fit-tier badge classes (results-page colours)`,
      /\.listing-fit-fg\{background:#E1F5EE;color:#085041\}/.test(htmlSrc) &&
      /\.listing-fit-fo\{background:#E6F1FB;color:#0C447C\}/.test(htmlSrc) &&
      /\.listing-fit-fs\{background:#FAEEDA;color:#633806\}/.test(htmlSrc) &&
      !/\.listing-badge-within\{/.test(htmlSrc)
    );
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
