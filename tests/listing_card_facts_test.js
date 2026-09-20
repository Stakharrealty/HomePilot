// Listing card redesign: permanent facts row (beds, baths, listed date) under
// the thumbnail, MLS® number + brokerage on the last line, no expandable
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
  const selectBlock = (ingestSrc.match(/PROPERTY_SELECT_FIELDS = \[([\s\S]*?)\]\.join/) || [])[1] || "";
  check("ingest $select requests ListingId and ListingContractDate, keeps ListingKey", /"ListingId"/.test(selectBlock) && /"ListingContractDate"/.test(selectBlock) && /"ListingKey"/.test(selectBlock));
  const withBoth = ingest.mapPropertyToRow({ ListingKey: "123", ListingId: "W1234567", ListingContractDate: "2026-09-12" });
  check("mapPropertyToRow stores mls_number from ListingId (not ListingKey) and listed_date", withBoth.mls_number === "W1234567" && withBoth.listing_key === "123" && withBoth.listed_date === "2026-09-12");
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
  check("facts row: beds, baths and listed date on one line", txt(full, ".listing-facts-row") === "Beds: 3 · Baths: 2 · Listed: Sep 12, 2026", txt(full, ".listing-facts-row"));
  check("bottom line: MLS® number + brokerage together on one line", txt(full, ".listing-brokerage") === "MLS® W1234567 · Listed by RE/MAX Realty Specialists Inc.", txt(full, ".listing-brokerage"));
  const body = full.querySelector(".listing-body");
  const kids = [...body.children];
  check("order: facts row first (under the thumbnail, above price)", kids[0].classList.contains("listing-facts-row") && kids[1].classList.contains("listing-price"));
  check("order: the MLS + brokerage line is the last element on the card", kids[kids.length - 1].classList.contains("listing-brokerage"));
  check("brokerage line keeps the .listing-brokerage class (13px, same as .listing-meta -- Article 6.3(c))",
    kids[kids.length - 1].className === "listing-brokerage" && /\.listing-brokerage\{font-size:13px/.test(read("listings.html")) && /\.listing-meta\{font-size:13px/.test(read("listings.html")));
  check("no MLS# on the price/facts lines", !/MLS/.test(txt(full, ".listing-facts-row")));

  check("MLS absent: line is exactly 'Listed by <brokerage>' (segment silently omitted)",
    txt(render({ brokerageName: "B" }), ".listing-brokerage") === "Listed by B");
  check("MLS blank / whitespace / null is treated as absent", ["", "   ", null, undefined].every((v) => txt(render({ brokerageName: "B", mlsNumber: v }), ".listing-brokerage") === "Listed by B"));
  check("brokerage missing but MLS present: 'MLS® W1 · Listed by Brokerage not available'", txt(render({ mlsNumber: "W1" }), ".listing-brokerage") === "MLS® W1 · Listed by Brokerage not available");

  check("date missing: row is just beds and baths", txt(render({ bedrooms: 2, bathrooms: 1 }), ".listing-facts-row") === "Beds: 2 · Baths: 1");
  check("beds missing: baths and date remain", txt(render({ bathrooms: 1, listedDate: "2026-01-05" }), ".listing-facts-row") === "Baths: 1 · Listed: Jan 5, 2026");
  check("zero beds (studio) is a real value, not omitted", txt(render({ bedrooms: 0, bathrooms: 1 }), ".listing-facts-row") === "Beds: 0 · Baths: 1");
  const none = render({});
  check("nothing stored: no facts row at all (no empty line, no N/A)", !none.querySelector(".listing-facts-row") && !/N\/A|null|undefined/.test(none.textContent.replace("Brokerage not available", "")));
  check("ISO timestamp uses the calendar date only (no timezone shift)", txt(render({ listedDate: "2026-09-12T00:00:00Z" }), ".listing-facts-row") === "Listed: Sep 12, 2026" && txt(render({ listedDate: "2026-12-31T23:59:59-05:00" }), ".listing-facts-row") === "Listed: Dec 31, 2026");
  check("an unparseable date is omitted, not shown raw", !render({ listedDate: "yesterday" }).querySelector(".listing-facts-row") && !render({ listedDate: "2026-13-40" }).querySelector(".listing-facts-row"));
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
