// Listings relevance: no land or junk, a bedroom minimum from family size, and
// best match first. IMPROVEMENT_PLAN.md 1.1 (REVIEW_BACKLOG.md P0-1, P1-14).
//
// The plan's own finish line: "Hamilton at $440K opens with 2+ bedroom homes
// near budget, and no $1 or land listings appear anywhere." Section 6 below is
// that sentence, end to end: the real listings page code (listings-display.js)
// fetching through the real Worker route (index.js) into the real query
// (db.js), run against real SQLite.
//
// The seed rows are shaped on production listings seen on 2026-09-23: building
// lots and development sites filed as "Detached" / "Triplex" with no bedrooms,
// a parking space and a retail unit filed as "Condo Apartment", genuine studio
// condos, and ordinary 1-3 bedroom condos around a $440K budget.
//
// Run: node --no-warnings tests/listings_relevance_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "workers", "homepilot-listings", "src");
const load = (f) => import(pathToFileURL(path.join(SRC, f)).href);

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail ? " :: " + detail : "")); }
}

// [key, price, subtype, beds, baths, listedDate]
const HAMILTON = [
  // Not homes -- must never be shown, whatever the filters.
  ["LOT1", 430000, "Detached", 0, 0, "2026-09-20"],     // "Build your dream home... lot"
  ["LOT2", 450000, "Triplex", 0, 0, "2026-09-21"],      // "Attention builders... redevelopment"
  ["LOT3", 410000, "Detached", 0, 1, "2026-09-19"],     // a lot with a washroom shed: still no bedroom
  ["PARK", 150000, "Condo Apartment", 0, 0, "2026-09-18"], // "2 Tandem Parking in P4"
  ["GAMED", 1, "Detached", 3, 2, "2026-09-22"],         // the $1 sort-gaming listing
  ["FRAC", 48500, "Condo Apartment", 2, 2, "2026-09-17"], // fractional resort share
  // Homes.
  ["STUDIO", 300000, "Condo Apartment", 0, 1, "2026-09-16"],
  ["C1", 438000, "Condo Apartment", 1, 1, "2026-09-15"],
  ["C2", 440000, "Condo Apartment", 2, 2, "2026-09-01"],
  ["C3", 425000, "Condo Apartment", 2, 1, "2026-09-02"],
  ["C9", 425000, "Condo Townhouse", 2, 2, "2026-09-10"], // same price as C3, listed later
  ["C4", 399000, "Condo Apartment", 3, 2, "2026-09-03"],
  ["C8", 250000, "Condo Apartment", 2, 1, "2026-09-04"],
  ["C5", 445000, "Condo Apartment", 2, 2, "2026-09-05"],  // just over budget
  ["C6", 484000, "Condo Townhouse", 2, 2, "2026-09-06"],  // exactly at the 10% ceiling
  ["C7", 485000, "Condo Apartment", 2, 2, "2026-09-07"],  // $1,000 past the ceiling
  ["D1", 420000, "Detached", 3, 1, "2026-09-08"],
  ["D2", 470000, "Semi-Detached", null, null, "2026-09-09"], // bedroom count missing
  // Added 2026-09-23 (market research): tenures the app cannot cost, and dens.
  ["LIFE", 430000, "Leasehold Condo", 2, 1, "2026-09-11", "Well Managed Life Lease Senior Residence (55+). Requires cash only offers as no mortgage can be registered against a life lease."],
  ["DEED", 432000, "Condo Apartment", 2, 1, "2026-09-12", "Ideal for seniors. Has Deed (Not Life Lease). Newly renovated."],
  ["LAND", 420000, "Detached", 2, 1, "2026-09-13", "A land lease community with a current lease fee of $604.97 per month."],
  ["DEN1", 436000, "Condo Apartment", 2, 1, "2026-09-14", "Bright 1+den suite with a walkout balcony."],
  ["DEN2", 437000, "Condo Apartment", 3, 2, "2026-09-15", "Spacious 2 bedroom plus den corner unit."],
  ["AGE", 433000, "Condo Townhouse", 2, 2, "2026-09-16", "Bungalow townhome in a 55+ gated community."],
];

function seed() {
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
  const fresh = new Date().toISOString();
  const ins = sqlite.prepare("INSERT INTO listings (listing_key, list_price, city, property_subtype, bedrooms," +
    " bathrooms, listed_date, public_remarks, listing_url, brokerage_name, photos, last_updated, source, transaction_type, standard_status)" +
    " VALUES (?, ?, 'Hamilton', ?, ?, ?, ?, ?, '', 'Test Realty', '[]', ?, 'PROPTX', 'For Sale', 'Active')");
  for (const [k, p, st, bd, ba, ld, remarks] of HAMILTON) ins.run(k, p, st, bd, ba, ld + "T12:00:00Z", remarks || null, fresh);
  return {
    prepare(sql) {
      let a = [];
      const st = {
        bind(...x) { a = x; return st; },
        async all() { return { results: sqlite.prepare(sql).all(...a) }; },
      };
      return st;
    },
  };
}

(async () => {
  const db = await load("db.js");
  const worker = (await load("index.js")).default;
  const d1 = seed();
  const keys = (rows) => rows.map((r) => r.listingKey);
  const NOT_HOMES = ["LOT1", "LOT2", "LOT3", "PARK", "GAMED", "FRAC", "LIFE", "LAND"];

  // =============== 1. what is never shown ===============
  const everything = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null);
  check("(1a) no lot, site, parking space, $1 or fractional listing is returned",
    !keys(everything).some((k) => NOT_HOMES.includes(k)), keys(everything).join(","));
  check("(1b) a studio condo (no bedroom, one bathroom) is a home and is shown", keys(everything).includes("STUDIO"));
  check("(1c) a home whose bedroom count is missing is not treated as land", keys(everything).includes("D2"));
  for (const k of ["LOT1", "PARK"]) {
    check(`(1d) the detail page refuses ${k} too`, (await db.getListingByKey(d1, k)) === null);
  }
  check("(1e) ...and still serves the studio", !!(await db.getListingByKey(d1, "STUDIO")));

  // =============== 2. minimum bedrooms ===============
  const twoPlus = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null, null, null, { minBeds: 2 });
  check("(2a) beds 2+ returns only homes with at least two bedrooms",
    twoPlus.length > 0 && twoPlus.every((r) => r.bedrooms >= 2), JSON.stringify(twoPlus.map((r) => [r.listingKey, r.bedrooms])));
  check("(2b) beds 2+ drops the one-bedroom and the studio", !keys(twoPlus).includes("C1") && !keys(twoPlus).includes("STUDIO"));
  for (const bad of [0, 6, 2.5, "two", -1, null, undefined]) {
    const r = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null, null, null, { minBeds: bad });
    check(`(2c) minBeds ${JSON.stringify(bad)} is treated as any`, r.length === everything.length, `${r.length} vs ${everything.length}`);
  }

  // =============== 3. best match ===============
  const best = await db.getListingsByCity(d1, "Hamilton", 100, "condo", 0, 440000, null, null, { minBeds: 2, sort: "best" });
  check("(3a) best match: at-or-under budget first, closest first, then the stretch band closest first",
    keys(best).join(",") === "C2,DEN2,AGE,DEED,C9,C3,C4,C8,C5,C6", keys(best).join(","));
  check("(3b) a tie on price goes to the newer listing (C9 listed after C3)", keys(best).indexOf("C9") < keys(best).indexOf("C3"));
  check("(3c) nothing past the 10% ceiling (C7 at $485,000 on a $440,000 budget)", !keys(best).includes("C7"));
  const byDefault = await db.getListingsByCity(d1, "Hamilton", 100, "condo", 0, 440000, null, null, { minBeds: 2 });
  check("(3d) with a budget, best match is the default order", keys(byDefault).join(",") === keys(best).join(","));
  const bogus = await db.getListingsByCity(d1, "Hamilton", 100, "condo", 0, 440000, null, null, { minBeds: 2, sort: "cheapest; DROP TABLE listings" });
  check("(3e) an unknown sort value falls back to the default, never into SQL", keys(bogus).join(",") === keys(best).join(","));

  // =============== 4. the other orders ===============
  const price = await db.getListingsByCity(d1, "Hamilton", 100, "condo", 0, 440000, null, null, { minBeds: 2, sort: "price" });
  check("(4a) 'price' is cheapest first", price.every((r, i) => i === 0 || price[i - 1].listPrice <= r.listPrice), keys(price).join(","));
  const newest = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null, null, null, { sort: "newest" });
  check("(4b) 'newest' is most recently listed first",
    newest.every((r, i) => i === 0 || newest[i - 1].listedDate >= r.listedDate), keys(newest).join(","));
  const noBudget = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null);
  check("(4c) with no budget to be close to, the default is newest", keys(noBudget).join(",") === keys(newest).join(","));
  check("(4d) effectiveSort: best needs a budget", db.effectiveSort("best", false) === "newest" && db.effectiveSort("best", true) === "best"
    && db.effectiveSort(undefined, true) === "best" && db.effectiveSort("price", false) === "price");

  // =============== 5. paging never repeats or skips a home ===============
  for (const sort of ["best", "price", "newest"]) {
    const whole = keys(await db.getListingsByCity(d1, "Hamilton", 100, null, 0, 440000, null, null, { sort }));
    const paged = [];
    for (let off = 0; off < whole.length; off += 2) {
      paged.push(...keys(await db.getListingsByCity(d1, "Hamilton", 2, null, off, 440000, null, null, { sort })));
    }
    check(`(5) '${sort}': pages of 2 add up to the whole list, same order, no repeats`, paged.join(",") === whole.join(","), `${paged} vs ${whole}`);
  }

  // =============== 6. the route: beds and sort reach the query ===============
  const call = async (qs) => {
    const res = await worker.fetch(new Request("https://homepilot-listings.stakharrealty.workers.dev/listings?" + qs), { DB: d1 });
    return res.json();
  };
  const r1 = await call("city=Hamilton&type=condo&budget=440000&beds=2");
  check("(6a) route: beds=2 and a budget give best match, 2+ bedrooms",
    r1.sort === "best" && r1.minBeds === 2 && keys(r1.listings).join(",") === "C2,DEN2,AGE,DEED,C9,C3,C4,C8,C5,C6", JSON.stringify([r1.sort, r1.minBeds, keys(r1.listings)]));
  const r2 = await call("city=Hamilton&beds=abc&sort=nonsense");
  check("(6b) route: junk beds/sort values mean any bedrooms and the default order", r2.minBeds === null && r2.sort === "newest", JSON.stringify([r2.minBeds, r2.sort]));
  const r3 = await call("city=Hamilton&sort=price");
  check("(6c) route: sort=price is honoured, and cheapest-first opens on a real home ($250,000), not the $1 one",
    r3.sort === "price" && r3.listings[0].listingKey === "C8"
      && r3.listings.every((r, i) => i === 0 || r3.listings[i - 1].listPrice <= r.listPrice), keys(r3.listings).join(","));

  // =============== 7. the browser half ===============
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root" class="live-listings-container"></div></body>`, {
    runScripts: "outside-only", url: "https://myhomepilot.ca/listings.html?city=Hamilton&type=condo&budget=440000",
  });
  const win = dom.window;
  const requests = [];
  // Every request from the page goes through the real Worker route and query.
  win.fetch = async (u) => {
    requests.push(String(u));
    const res = await worker.fetch(new Request(String(u)), { DB: d1 });
    const body = await res.json();
    return { ok: res.ok, json: async () => body };
  };
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  for (const f of ["ai.js", "listing-fit.js", "listings-display.js"]) win.eval(fs.readFileSync(path.join(ROOT, "src", f), "utf8"));

  const fam = (n) => win.defaultMinBedsForFamily(n);
  check("(7a) family size -> bedrooms: 1-2 people 1+, 3 people 2+, 4 or more 3+",
    fam(1) === 1 && fam(2) === 1 && fam("3") === 2 && fam(4) === 3 && fam("5") === 3, [1, 2, 3, 4, 5].map(fam).join());
  check("(7b) unknown family size: no minimum", fam(undefined) === null && fam("x") === null && fam(0) === null);

  const P = (qs) => new win.URLSearchParams(qs);
  const opt = (qs, profile, budget) => JSON.stringify(win.resolveListingOptions(P(qs), profile, budget));
  check("(7c) first visit, family of 3, $440K: best match, 2+ bedrooms", opt("", { familySize: "3" }, 440000) === JSON.stringify({ sort: "best", minBeds: 2 }));
  check("(7d) the buyer's own choices in the URL win over the defaults", opt("sort=price&beds=4", { familySize: "3" }, 440000) === JSON.stringify({ sort: "price", minBeds: 4 }));
  check("(7e) beds=any keeps an explicit 'Any' instead of re-applying the family default", opt("beds=any", { familySize: "4" }, 440000) === JSON.stringify({ sort: "best", minBeds: null }));
  check("(7f) no budget: newest, and best match is not offered as the default", opt("", null, undefined) === JSON.stringify({ sort: "newest", minBeds: null })
    && opt("sort=best", null, undefined) === JSON.stringify({ sort: "newest", minBeds: null }));
  check("(7g) an out-of-range beds value falls back to the family default", opt("beds=9", { familySize: "2" }, 440000) === JSON.stringify({ sort: "best", minBeds: 1 }));

  const L = (o) => win.ldIsListableHome({ listPrice: 500000, propertyType: "detached", bedrooms: 3, bathrooms: 2, ...o });
  check("(7h) browser floor: $1 and a fractional share are not homes", !L({ listPrice: 1 }) && !L({ listPrice: 48500 }) && L({ listPrice: 75000 }));
  check("(7i) browser land rule: a house with no bedroom is not a home; a studio condo is; a no-bath condo is not",
    !L({ bedrooms: 0, bathrooms: 0 }) && !L({ bedrooms: 0, bathrooms: 1 }) && !L({ propertyType: null, bedrooms: 0 })
    && L({ propertyType: "condo", bedrooms: 0, bathrooms: 1 }) && !L({ propertyType: "condo", bedrooms: 0, bathrooms: 0 })
    && L({ bedrooms: null, bathrooms: null }));

  // The finish line: a Hamilton $440K condo card, family of three.
  const root = win.document.getElementById("root");
  const first = win.resolveListingOptions(new win.URLSearchParams(win.location.search), { familySize: "3" }, 440000);
  await win.renderLiveListings("Hamilton", root, "condo", 440000, first);
  const cards = [...root.querySelectorAll(".listing-card")];
  const priceOf = (c) => Number(c.querySelector(".listing-price").textContent.replace(/[^0-9]/g, "").slice(0, 7));
  const bedsOf = (c) => { const m = /Beds: (\d+)/.exec(c.textContent); return m ? Number(m[1]) : null; };
  check("(7j) DONE WHEN: Hamilton at $440K opens on a 2+ bedroom home at the budget",
    cards.length > 0 && priceOf(cards[0]) === 440000 && bedsOf(cards[0]) >= 2, cards.slice(0, 3).map((c) => [priceOf(c), bedsOf(c)]).join(" | "));
  check("(7k) DONE WHEN: every card has 2+ bedrooms", cards.every((c) => bedsOf(c) >= 2), cards.map(bedsOf).join(","));
  check("(7l) DONE WHEN: no $1, fractional or land listing on the page",
    cards.every((c) => priceOf(c) >= 75000) && !/LOT|PARK|GAMED|FRAC/.test(requests.join("") + root.innerHTML.replace(/listing\.html\?key=C\d/g, "")),
    cards.map(priceOf).join(","));
  check("(7m) the request carried the order and the bedroom minimum", /sort=best/.test(requests[0]) && /beds=2/.test(requests[0]), requests[0]);
  const note = root.querySelector(".listings-sort-note");
  check("(7n) a one-line note says what the order is", !!note && note.textContent.includes("$440,000") && /2\+ bedrooms/.test(note.textContent), note && note.textContent);

  // The controls.
  const group = (label) => [...root.querySelectorAll(".refine-group")].find((g) => g.querySelector(".filter-label").textContent === label);
  const pills = (label) => [...group(label).querySelectorAll(".fb")];
  const on = (label) => pills(label).filter((b) => b.classList.contains("on")).map((b) => b.textContent).join();
  check("(7o) bedroom pills Any/1+/2+/3+/4+, with 2+ picked", pills("Bedrooms").map((b) => b.textContent).join() === "Any,1+,2+,3+,4+" && on("Bedrooms") === "2+");
  check("(7p) sort pills Best match/Lowest price/Newest, with Best match picked", pills("Sort by").map((b) => b.textContent).join() === "Best match,Lowest price,Newest" && on("Sort by") === "Best match");

  requests.length = 0;
  pills("Bedrooms")[0].click(); // Any
  await new Promise((r) => setTimeout(r, 30));
  check("(7q) picking 'Any' re-fetches with no bedroom minimum", requests.length === 1 && !/beds=/.test(requests[0]), requests.join(" | "));
  check("(7r) ...records beds=any in the URL, keeping the order", /beds=any/.test(win.location.search) && /sort=best/.test(win.location.search), win.location.search);
  check("(7s) ...and the studio condo appears (it has no bedroom)", /\$300,000/.test(root.textContent));
  pills("Sort by")[1].click(); // Lowest price
  await new Promise((r) => setTimeout(r, 30));
  check("(7t) picking 'Lowest price' re-fetches cheapest first", /sort=price/.test(requests[requests.length - 1]) && on("Sort by") === "Lowest price" && on("Bedrooms") === "Any");
  const cheapest = [...root.querySelectorAll(".listing-card")].map(priceOf);
  check("(7u) ...and even cheapest-first, nothing under the floor tops the page", cheapest[0] >= 75000 && cheapest.every((p, i) => i === 0 || cheapest[i - 1] <= p), cheapest.join(","));

  // No budget: best match is not offered.
  const root2 = win.document.createElement("div");
  win.document.body.appendChild(root2);
  await win.renderLiveListings("Hamilton", root2, "all", undefined, { minBeds: null });
  const sortLabels = [...root2.querySelectorAll(".refine-group")].find((g) => g.querySelector(".filter-label").textContent === "Sort by");
  check("(7v) without a budget there is no 'Best match' pill, and Newest is picked",
    !/Best match/.test(sortLabels.textContent) && sortLabels.querySelector(".fb.on").textContent === "Newest");

  // Belt and braces: junk that reaches the browser anyway gets no card.
  const junkApi = [
    { listingKey: "J1", listPrice: 1, propertyType: "detached", bedrooms: 3, bathrooms: 2, city: "Hamilton", photos: [] },
    { listingKey: "J2", listPrice: 430000, propertyType: "detached", bedrooms: 0, bathrooms: 0, city: "Hamilton", photos: [] },
    { listingKey: "J3", listPrice: 150000, propertyType: "condo", bedrooms: 0, bathrooms: 0, city: "Hamilton", photos: [] },
    { listingKey: "OK1", listPrice: 300000, propertyType: "condo", bedrooms: 0, bathrooms: 1, city: "Hamilton", photos: [] },
    { listingKey: "OK2", listPrice: 420000, propertyType: "detached", bedrooms: 3, bathrooms: 1, city: "Hamilton", photos: [] },
  ];
  win.fetch = async () => ({ ok: true, json: async () => ({ listings: junkApi }) });
  const root3 = win.document.createElement("div");
  win.document.body.appendChild(root3);
  await win.renderLiveListings("Hamilton", root3, "all", 440000, { sort: "best", minBeds: null });
  const shownKeys = [...root3.querySelectorAll("a.listing-detail-link")].map((a) => /key=([^&]+)/.exec(a.getAttribute("href"))[1]);
  check("(7w) a stale or broken API's $1, lot and parking rows never get a card", shownKeys.join(",") === "OK1,OK2", shownKeys.join(","));

  // Empty state names the bedroom filter, so the buyer knows what to loosen.
  win.fetch = async () => ({ ok: true, json: async () => ({ listings: [] }) });
  const root4 = win.document.createElement("div");
  win.document.body.appendChild(root4);
  await win.renderLiveListings("Hamilton", root4, "condo", 440000, { sort: "best", minBeds: 4 });
  const empty = root4.querySelector(".listings-empty");
  check("(7x) empty state names the bedroom minimum and suggests fewer bedrooms",
    !!empty && /with 4\+ bedrooms/.test(empty.textContent) && /fewer bedrooms/.test(empty.textContent), empty && empty.textContent);
  check("(7y) ...and keeps the controls so the buyer can loosen it", !!root4.querySelector(".listings-refine"));

  // =============== 8. tenures the app cannot cost, dens, and 55+ (2026-09-23) ===============
  const anyBeds = keys(await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null));
  check("(8a) a life lease is not shown (no mortgage can be registered against one)", !anyBeds.includes("LIFE"));
  check("(8b) ...but a listing that says it is NOT a life lease is", anyBeds.includes("DEED"));
  check("(8c) a land-lease home is not shown (its land fee is not in the monthly cost)", !anyBeds.includes("LAND"));
  check("(8d) neither is served on a detail page", (await db.getListingByKey(d1, "LIFE")) === null && (await db.getListingByKey(d1, "LAND")) === null);
  const one = await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null, null, null, { minBeds: 1 });
  const den1 = one.find((r) => r.listingKey === "DEN1");
  check("(8e) a '1+den' condo stored as 2 bedrooms counts as 1", !!den1 && den1.bedrooms === 2 && den1.effectiveBedrooms === 1);
  check("(8f) ...so it is not in a 2+ bedroom search, but is in a 1+ search", !keys(twoPlus).includes("DEN1") && keys(one).includes("DEN1"));
  const three = keys(await db.getListingsByCity(d1, "Hamilton", 100, null, 0, null, null, null, { minBeds: 3 }));
  check("(8g) a '2 bedroom plus den' stored as 3 is in a 2+ search, not a 3+ one", keys(best).includes("DEN2") && !three.includes("DEN2"));
  const plain2 = one.find((r) => r.listingKey === "C2");
  check("(8h) a real 2-bedroom keeps its 2", plain2 && plain2.effectiveBedrooms === 2);
  check("(8i) browser: the same tenure rule", !win.ldIsListableHome({ listPrice: 430000, propertyType: "condo", bedrooms: 2, bathrooms: 1, publicRemarks: "Life Lease for Senior Living" })
    && win.ldIsListableHome({ listPrice: 430000, propertyType: "condo", bedrooms: 2, bathrooms: 1, publicRemarks: "Has Deed (Not Life Lease)" })
    && !win.ldIsListableHome({ listPrice: 420000, propertyType: "detached", bedrooms: 2, bathrooms: 1, publicRemarks: "a land-lease community" }));
  check("(8j) browser: beds read '1 + den', and a plain count is untouched",
    win.ldBedsText({ bedrooms: 2, effectiveBedrooms: 1 }) === "1 + den" && win.ldBedsText({ bedrooms: 2, effectiveBedrooms: 2 }) === "2" && win.ldBedsText({ bedrooms: 3 }) === "3" && win.ldBedsText({}) === null);
  check("(8k) browser: 55+ and adult-lifestyle communities are recognised, 'suits seniors' is not",
    win.ldAgeRestricted({ publicRemarks: "in a 55+ gated community" }) && win.ldAgeRestricted({ publicRemarks: "Adult Lifestyle Community" })
    && win.ldAgeRestricted({ publicRemarks: "Residence (55+). Bright unit" }) && !win.ldAgeRestricted({ publicRemarks: "would suit family, couple or seniors" }));
  // On the page: the 55+ townhome is shown, labelled; the den condo says so.
  win.fetch = async (u) => { const res = await worker.fetch(new Request(String(u)), { DB: d1 }); const body = await res.json(); return { ok: res.ok, json: async () => body }; };
  const root5 = win.document.createElement("div");
  win.document.body.appendChild(root5);
  await win.renderLiveListings("Hamilton", root5, "condo", 440000, { sort: "best", minBeds: null });
  const cardFor = (key) => [...root5.querySelectorAll(".listing-card")].find((c) => (c.querySelector("a.listing-detail-link") || { getAttribute: () => "" }).getAttribute("href").includes("key=" + key + "&"));
  const ageCard = cardFor("AGE"), denCard = cardFor("DEN1");
  check("(8l) the 55+ home is on the page, with the age label", !!ageCard && /Age-restricted community/.test(ageCard.textContent));
  check("(8m) an ordinary home carries no age label", !!cardFor("C2") && !/Age-restricted/.test(cardFor("C2").textContent));
  check("(8n) the 1+den condo reads 'Beds: 1 + den'", !!denCard && denCard.textContent.includes("Beds: 1 + den"), denCard && denCard.querySelector(".listing-facts-row") && denCard.querySelector(".listing-facts-row").textContent);

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
