// PropTx IDX Article 6.3 compliance test (2026-09-18).
//
// Checks the listings display against the signed PROPTX IDX Data
// Agreement, Article 6.3:
//   (b) at most 100 listings per consumer inquiry
//   (c) listing brokerage in the same font and size as the other listing
//       details, not visually separated
//   (i) notice: deemed reliable but not guaranteed accurate by PROPTX
//   (k) bona fide interest notice (agreement's suggested wording, verbatim)
//
// Runs offline: listings-display.js (plus ai.js for escapeHtml) inside a
// bare jsdom window with a fake /listings API. No network, no fonts.
//
// Run: node --no-warnings tests/listings_proptx_idx_notices_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

// Verbatim from the signed agreement, Article 6.3(k) suggested notice.
const AGREEMENT_BONA_FIDE = "The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose.";

function cssRule(html, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`(^|\\n)${esc}\\{([^}]*)\\}`));
  if (!m) return null;
  return Object.fromEntries(m[2].split(";").filter(Boolean).map((d) => {
    const i = d.indexOf(":");
    return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
  }));
}

function makeListings(start, count) {
  return Array.from({ length: count }, (_, i) => ({
    listingKey: `L${start + i}`, listPrice: 700000 + i, city: "Mississauga",
    bedrooms: 3, bathrooms: 2, listingUrl: "", brokerageName: "TEST REALTY INC.",
    photos: [], propertyType: "detached",
  }));
}

(async () => {
  // --- (c) brokerage styling, on every page that renders listing cards ---
  for (const page of ["listings.html", "index.html", "calculator.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const meta = cssRule(html, ".listing-meta");
    const brok = cssRule(html, ".listing-brokerage");
    check(`${page}: brokerage font-size equals other listing details (${meta && meta["font-size"]})`,
      meta && brok && brok["font-size"] === meta["font-size"], JSON.stringify({ meta, brok }));
    check(`${page}: brokerage colour equals other listing details`, meta && brok && brok.color === meta.color);
    check(`${page}: brokerage has no extra weight or gap setting it apart`,
      brok && !brok["font-weight"] && brok["margin-top"] === meta["margin-top"], JSON.stringify(brok));
  }

  // --- (k) bona fide notice in the site footer ---
  for (const page of ["index.html", "calculator.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    check(`${page}: footer carries the bona fide notice verbatim`, html.includes(AGREEMENT_BONA_FIDE));
  }

  // --- Render listings in jsdom with a fake API ---
  const requests = [];
  let TOTAL_AVAILABLE = 500; // more than the cap, to prove the cap bites
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root" class="live-listings-container"></div></body>`, {
    runScripts: "outside-only", url: "https://myhomepilot.ca/listings.html",
  });
  const win = dom.window;
  win.fetch = async (u) => {
    const q = new URL(u).searchParams;
    const offset = Number(q.get("offset")), limit = Number(q.get("limit"));
    requests.push({ offset, limit });
    const count = Math.max(0, Math.min(limit, TOTAL_AVAILABLE - offset));
    return { ok: true, json: async () => ({ listings: makeListings(offset, count) }) };
  };
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.eval(fs.readFileSync(path.join(ROOT, "src", "ai.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "src", "listings-display.js"), "utf8"));

  const root = win.document.getElementById("root");
  await win.renderLiveListings("Mississauga", root, "all", 900000);

  // --- (i) + (k) notices under the listings ---
  const notice = root.querySelector(".listings-idx-notice");
  check("notice block rendered with the listings", !!notice);
  const text = notice ? notice.textContent : "";
  check("(i) deemed-reliable notice names PROPTX", /deemed reliable but is not guaranteed accurate by PROPTX/.test(text), text);
  check("(k) bona fide notice is the agreement's wording, verbatim", text.includes(AGREEMENT_BONA_FIDE));
  const cards = () => root.querySelectorAll(".listing-card").length;
  check("first page shows 24 cards", cards() === 24, `${cards()}`);
  const firstBrok = root.querySelector(".listing-brokerage");
  check("(c) every card shows the brokerage", firstBrok && /TEST REALTY INC\./.test(firstBrok.textContent) &&
    root.querySelectorAll(".listing-brokerage").length === cards());
  const children = Array.from(root.children).map((c) => c.className);
  check("notice sits after the grid and the Load more button", children.indexOf("listings-idx-notice") > children.indexOf("listings-grid") &&
    children.indexOf("listings-idx-notice") > children.indexOf("listings-load-more"), JSON.stringify(children));

  // --- (b) 100 per search: click Load more until it stops ---
  for (let i = 0; i < 10; i++) {
    const btn = root.querySelector(".listings-load-more");
    if (!btn) break;
    await win.loadMoreListings(btn);
  }
  check("(b) no more than 100 listings ever shown for one search", cards() === 100, `${cards()}`);
  check("(b) no request ever asks past the 100th listing", requests.every((r) => r.offset + r.limit <= 100), JSON.stringify(requests));
  check("(b) Load more is gone once 100 is reached", !root.querySelector(".listings-load-more"));
  const cap = root.querySelector(".listings-cap-note");
  check("(b) a plain note explains the 100 limit", cap && /100/.test(cap.textContent), cap && cap.textContent);
  check("notice still present at the bottom after paging", root.lastElementChild.className === "listings-idx-notice");

  // Short city (fewer than 100): Load more simply ends, no cap note
  TOTAL_AVAILABLE = 30;
  requests.length = 0;
  const root2 = win.document.createElement("div");
  root2.className = "live-listings-container";
  win.document.body.appendChild(root2);
  await win.renderLiveListings("Mississauga", root2, "all", 900000);
  await win.loadMoreListings(root2.querySelector(".listings-load-more"));
  check("short city: all 30 shown, button gone, no cap note",
    root2.querySelectorAll(".listing-card").length === 30 && !root2.querySelector(".listings-load-more") && !root2.querySelector(".listings-cap-note"));

  // --- (b) server-side cap helper ---
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  check("server cap is 100", db.IDX_MAX_LISTINGS_PER_SEARCH === 100);
  check("server: offset 0, limit 50 -> 50", db.idxCappedLimit(50, 0) === 50);
  check("server: offset 96, limit 24 -> 4", db.idxCappedLimit(24, 96) === 4);
  check("server: offset 100 -> 0", db.idxCappedLimit(24, 100) === 0);
  check("server: offset 500 -> 0 (never negative)", db.idxCappedLimit(24, 500) === 0);
  const idx = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");
  check("/listings route passes the capped limit to the query",
    /const cappedLimit = idxCappedLimit\(limit, offset\);/.test(idx) &&
    /getListingsByCity\(env\.DB, city, cappedLimit, propertyType, offset, searchBudget, torontoDistricts, communities, \{ minBeds, sort \}\)/.test(idx));

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
