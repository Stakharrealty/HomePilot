// Listing card redesign: price row (price left, listed date + "N Days Ago" right),
// then address, then beds/baths, MLS number + brokerage on the last line, no expandable
// panel; plus the mls_number / listed_date plumbing (migration, ingest
// $select + mapper, db.js SELECT + mapping).
//
// jsdom over the local static server on :8843 (npx http-server -p 8843 -s);
// the worker modules run against a fake D1 (no network).
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "workers", "homepilot-listings", "src");
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

(async () => {
  // =============== 1. backend plumbing ===============
  const mig = read("workers/homepilot-listings/migrations/0004_mls_number_listed_date.sql");
  check("migration 0004 adds nullable mls_number and listed_date (additive only)",
    /ADD COLUMN mls_number TEXT;/.test(mig) && /ADD COLUMN listed_date TEXT;/.test(mig) && !/NOT NULL|DROP|UPDATE|DELETE/i.test(mig.replace(/--[^\n]*/g, "")));

  const ingest = await import(pathToFileURL(path.join(SRC, "proptx-ingest.js")).href);
  const ingestSrc = read("workers/homepilot-listings/src/proptx-ingest.js");
  const selectBlock = ((ingestSrc.match(/PROPERTY_SELECT_FIELDS = \[([\s\S]*?)\]\.join/) || [])[1] || "").replace(/\/\/[^\n]*/g, "");
  check("ingest $select requests ListingId and OriginalEntryTimestamp (ListingContractDate is always null in the feed), keeps ListingKey", /"ListingId"/.test(selectBlock) && /"OriginalEntryTimestamp"/.test(selectBlock) && !/ListingContractDate/.test(selectBlock) && /"ListingKey"/.test(selectBlock));
  const withBoth = ingest.mapPropertyToRow({ ListingKey: "123", ListingId: "W1234567", OriginalEntryTimestamp: "2026-09-12T14:00:00Z" });
  check("mapPropertyToRow stores mls_number from ListingId (not ListingKey) and listed_date", withBoth.mls_number === "W1234567" && withBoth.listing_key === "123" && withBoth.listed_date === "2026-09-12T14:00:00Z");
  const without = ingest.mapPropertyToRow({ ListingKey: "124" });
  check("mapPropertyToRow: absent fields are null, never guessed", without.mls_number === null && without.listed_date === null);

  const db = await import(pathToFileURL(path.join(SRC, "db.js")).href);
  let sqlList = "", sqlOne = "";
  const row = { listing_key: "K1", list_price: 1, photos: "[]", mls_number: "W1234567", listed_date: "2026-09-12" };
  const d1 = (capture) => ({ prepare(sql) { capture(sql); return { bind() { return { all: async () => ({ results: [row] }) }; } }; } });
  const [l1] = await db.getListingsByCity(d1((s) => { sqlList = s; }), "Mississauga", 20, null, 0, null);
  const l2 = await db.getListingByKey(d1((s) => { sqlOne = s; }), "K1");
  const selPart = (s) => s.split("FROM listings")[0];
  check("getListingsByCity selects mls_number and listed_date", /\bmls_number\b/.test(selPart(sqlList)) && /\blisted_date\b/.test(selPart(sqlList)));
  check("getListingByKey selects mls_number and listed_date", /\bmls_number\b/.test(selPart(sqlOne)) && /\blisted_date\b/.test(selPart(sqlOne)));
  check("both return mlsNumber / listedDate", l1.mlsNumber === "W1234567" && l1.listedDate === "2026-09-12" && l2.mlsNumber === "W1234567" && l2.listedDate === "2026-09-12");
  const [fb] = await db.getListingsByCity({ prepare() { return { bind() { return { all: async () => ({ results: [{ listing_key: "W13656642", list_price: 1, photos: null, mls_number: null }] }) }; } }; } }, "Mississauga", 20, null, 0, null);
  check("no stored ListingId: mlsNumber falls back to listing_key (the feed returns no ListingId)", fb.mlsNumber === "W13656642" && fb.listedDate == null);
  const [nul] = await db.getListingsByCity({ prepare() { return { bind() { return { all: async () => ({ results: [{ listing_key: "K2", list_price: 1, photos: null }] }) }; } }; } }, "Mississauga", 20, null, 0, null);
  check("listed date is never invented: an unbackfilled row has no listedDate", nul.listedDate == null);

  // =============== 2. card ===============
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;
  const render = (l) => win.renderListingCard({ listingKey: "K1", listPrice: 700000, city: "Mississauga", photos: [], propertyType: "detached", ...l }, null);
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent : null; };

  const full = render({ bedrooms: 3, bathrooms: 2, listedDate: "2026-09-12", mlsNumber: "W1234567", brokerageName: "RE/MAX Realty Specialists Inc." });
  check("beds/baths row holds only beds and baths (the date moved up beside the price)", txt(full, ".listing-facts-row") === "Beds: 3 · Baths: 2", txt(full, ".listing-facts-row"));
  check("bottom line: MLS number + brokerage together on one line (no 'MLS®' label)", txt(full, ".listing-brokerage") === "W1234567 · Listed by RE/MAX Realty Specialists Inc.", txt(full, ".listing-brokerage"));
  const body = full.querySelector(".listing-body");
  const kids = [...body.children];
  check("order: price row, then address (when present), then beds/baths, ..., MLS + brokerage last",
    kids[0].classList.contains("listing-price-row") && kids[1].classList.contains("listing-facts-row") && kids[kids.length - 1].classList.contains("listing-brokerage"), kids.map((k) => k.className).join(" | "));
  const addrCard = render({ displayAddress: "12 Example St", bedrooms: 2, bathrooms: 1, brokerageName: "B" });
  check("order with an address: price row -> address -> beds/baths -> pill links -> MLS/brokerage",
    [...addrCard.querySelector(".listing-body").children].map((k) => k.className.split(" ")[0]).join(",") === "listing-price-row,listing-address,listing-meta,listing-links,listing-brokerage");
  check("price row: price on the left, listed date group on the right", (() => {
    const row = full.querySelector(".listing-price-row");
    return row.children[0].classList.contains("listing-price") && row.children[1].classList.contains("listing-listed-date-group");
  })());
  check("listed date group: 'Listed: <date>' on top, age line below it", (() => {
    const g = full.querySelector(".listing-listed-date-group");
    return g.children[0].className === "listing-listed-date" && g.children[0].textContent === "Listed: Sep 12, 2026" && g.children[1].className === "listing-listed-date-ago";
  })());
  check("no beds/baths and no listed date on the price row's left side", !/Beds|Baths|Listed/.test(txt(full, ".listing-price")));
  check("no MLS# on the price/facts lines", !/MLS/.test(txt(full, ".listing-facts-row")) && !/MLS/.test(txt(full, ".listing-price-row")));
  check("brokerage line keeps the .listing-brokerage class (13px, same as .listing-meta -- Article 6.3(c))",
    kids[kids.length - 1].className === "listing-brokerage" && /\.listing-brokerage\{font-size:13px/.test(read("listings.html")) && /\.listing-meta\{font-size:13px/.test(read("listings.html")));

  check("MLS absent: line is exactly 'Listed by <brokerage>' (segment silently omitted)",
    txt(render({ brokerageName: "B" }), ".listing-brokerage") === "Listed by B");
  check("MLS blank / whitespace / null is treated as absent", ["", "   ", null, undefined].every((v) => txt(render({ brokerageName: "B", mlsNumber: v }), ".listing-brokerage") === "Listed by B"));
  check("brokerage missing but MLS present: 'W1 · Listed by Brokerage not available' (no 'MLS®' label)", txt(render({ mlsNumber: "W1" }), ".listing-brokerage") === "W1 · Listed by Brokerage not available");

  check("date missing: row is just beds and baths, and there is no date group or age", (() => {
    const c = render({ bedrooms: 2, bathrooms: 1 });
    return txt(c, ".listing-facts-row") === "Beds: 2 · Baths: 1" && !c.querySelector(".listing-listed-date-group, .listing-listed-date, .listing-listed-date-ago");
  })());
  check("beds missing: only baths on the row; the date stays top-right", (() => {
    const c = render({ bathrooms: 1, listedDate: "2026-01-05" });
    return txt(c, ".listing-facts-row") === "Baths: 1" && txt(c, ".listing-listed-date") === "Listed: Jan 5, 2026";
  })());
  check("zero beds (studio) is a real value, not omitted", txt(render({ bedrooms: 0, bathrooms: 1 }), ".listing-facts-row") === "Beds: 0 · Baths: 1");
  const none = render({});
  check("nothing stored: no facts row, no date group (no empty line, no N/A)", !none.querySelector(".listing-facts-row, .listing-listed-date-group") && !/N\/A|null|undefined/.test(none.textContent.replace("Brokerage not available", "")));
  const dateOf = (v) => txt(render({ listedDate: v }), ".listing-listed-date");
  check("UTC timestamp shows the Toronto calendar day (real PropTx sample 2026-02-01T04:00:48Z was Jan 31, 11pm in Toronto)", dateOf("2026-02-01T04:00:48Z") === "Listed: Jan 31, 2026" && dateOf("2026-01-08T17:33:04Z") === "Listed: Jan 8, 2026" && dateOf("2026-07-15T03:30:00Z") === "Listed: Jul 14, 2026" && dateOf("2026-12-31T23:59:59-05:00") === "Listed: Dec 31, 2026");
  check("a bare date is used as-is", dateOf("2026-09-12") === "Listed: Sep 12, 2026");
  check("an unparseable date is omitted, not shown raw", !render({ listedDate: "yesterday" }).querySelector(".listing-listed-date-group") && !render({ listedDate: "2026-13-40" }).querySelector(".listing-listed-date-group"));

  // ---- relative age ("N Days Ago"), computed live from the listed date ----
  const ago = win.eval("listedDaysAgoText");
  const NOW = new Date("2026-09-20T15:00:00Z"); // Sep 20, 11am in Toronto
  check("age: same Toronto day -> 'Listed Today'", ago("2026-09-20", NOW) === "Listed Today" && ago("2026-09-20T04:30:00Z", NOW) === "Listed Today");
  check("age: 1 day -> '1 Day Ago' (singular)", ago("2026-09-19", NOW) === "1 Day Ago");
  check("age: N days -> 'N Days Ago' (16, 2, 30)", ago("2026-09-04", NOW) === "16 Days Ago" && ago("2026-09-18", NOW) === "2 Days Ago" && ago("2026-08-21", NOW) === "30 Days Ago");
  check("age: counts whole Toronto calendar days across a month and a year boundary", ago("2026-01-01", NOW) === "262 Days Ago" && ago("2025-09-20", NOW) === "365 Days Ago");
  check("age: a listed date in the future (timezone edge) is clamped to 'Listed Today', never negative", ago("2026-09-21", NOW) === "Listed Today" && ago("2027-01-01", NOW) === "Listed Today");
  check("age: late-evening Toronto entry is measured from its Toronto day (2026-09-19T03:30Z was Sep 18 in Toronto)", ago("2026-09-19T03:30:00Z", NOW) === "2 Days Ago");
  check("age: DST changeover does not skew the day count (Mar 8 -> Mar 15, 2026)", ago("2026-03-08", new Date("2026-03-15T16:00:00Z")) === "7 Days Ago");
  check("age: no listed date -> null (never invented)", ago(null, NOW) === null && ago(undefined, NOW) === null && ago("", NOW) === null && ago("yesterday", NOW) === null);
  // rendered end to end against the real clock (today's Toronto date, minus N calendar days)
  const torontoToday = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const daysBack = (n) => new Date(Date.UTC(Number(torontoToday.year), Number(torontoToday.month) - 1, Number(torontoToday.day) - n)).toISOString().slice(0, 10);
  const agoOf = (n) => txt(render({ listedDate: daysBack(n) }), ".listing-listed-date-ago");
  check("rendered live: today -> 'Listed Today', 1 -> '1 Day Ago', 16 -> '16 Days Ago', 45 -> '45 Days Ago'", agoOf(0) === "Listed Today" && agoOf(1) === "1 Day Ago" && agoOf(16) === "16 Days Ago" && agoOf(45) === "45 Days Ago", [agoOf(0), agoOf(1), agoOf(16), agoOf(45)].join(" / "));
  check("the age is computed at render time, not hardcoded", !/16 Days Ago|"\d+ Days Ago"/.test(read("src/listings-display.js").replace(/\/\/[^\n]*/g, "")));
  check("age is escaped/inert and only appears with a real listed date", !render({ bedrooms: 1 }).querySelector(".listing-listed-date-ago") && !render({ listedDate: "<b>x</b>" }).querySelector(".listing-listed-date-ago"));
  check("card CSS for the new row exists in index.html, listings.html and calculator.html",
    ["index.html", "listings.html", "calculator.html"].every((p) => {
      const h = read(p);
      return /\.listing-price-row\{display:flex;justify-content:space-between;align-items:flex-start/.test(h) &&
        /\.listing-listed-date-group\{display:flex;flex-direction:column;align-items:flex-end;text-align:right/.test(h) &&
        /\.listing-listed-date-ago\{font-size:11px/.test(h) && /\.listing-listed-date\{font-size:12px/.test(h);
    }));
  check("square footage is not on the card", !/sq|sqft|square/i.test(full.textContent));

  check("expandable panel is gone: no toggle, panel, remarks, facts, tour on the card", !full.querySelector(".listing-details-toggle, .listing-details-panel, .listing-remarks, .listing-detail-facts, .listing-virtual-tour, .listing-remarks-more"));
  const rich = render({ garageType: "Attached", basement: "Finished", cooling: "Central Air", taxAnnualAmount: 4200, publicRemarks: "Long remarks here", virtualTourUrl: "https://t.example.com/x" });
  check("garage / basement / cooling / tax / remarks / tour text no longer on the card", !/Garage|Basement|Cooling|tax|Long remarks|Virtual tour/i.test(rich.textContent), rich.textContent);
  const src = read("src/listings-display.js");
  check("display JS no longer contains the toggle or read-more code", !/listing-details-toggle|listing-details-panel|listing-remarks|hasExpandableDetail/.test(src));

  // untouched: the two pill links
  const links = full.querySelector(".listing-links");
  check("pill links unchanged: same wrapper, classes, hrefs, labels, new-tab attrs",
    !!links && links.querySelector("a.listing-detail-link").getAttribute("href") === "listing.html?key=K1" && /^View full details/.test(links.querySelector("a.listing-detail-link").textContent) &&
    links.querySelector("a.listing-source-link").getAttribute("href") === "listing-full.html?key=K1" && links.querySelector("a.listing-source-link").textContent === "View Details" &&
    links.querySelector("a.listing-source-link").target === "_blank" && /noopener/.test(links.querySelector("a.listing-source-link").rel));
  check("pill CSS rules unchanged in index.html and listings.html",
    ["index.html", "listings.html"].every((p) => read(p).includes(".listing-source-link{background:#E6F1FB;color:#185FA5}") && read(p).includes(".listing-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}")));

  // safety
  const evil = render({ mlsNumber: "<img src=x onerror=alert(1)>", brokerageName: "<b>x</b>", listedDate: "2026-09-12", bedrooms: "<script>1</script>" });
  check("hostile MLS / brokerage / beds values render as inert text", evil.querySelectorAll("img, b, script").length === 0 || [...evil.querySelectorAll("img")].every((i) => i.classList.contains("listing-photo")));
  check("no script errors while loading", errors.length === 0, errors.join(" | "));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
