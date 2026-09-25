// "View Available Homes" opens the listings in a normal tab, no pop-up
// (IMPROVEMENT_PLAN 2.7, 2026-09-24). Replaces listings_popup_sizing_test.js
// and listings_popup_redesign_test.js, which tested the old pop-up window.
//
// What is checked:
//   A. Static: the pop-up code is gone (window.open, resizeTo/moveTo,
//      window.opener), both "View Available Homes" controls in render.js are
//      plain links, and the listings page is still its own self-contained page
//      (the checks ported from listings_popup_redesign_test.js).
//   B. The link, run for real in jsdom: a new tab (target=_blank
//      rel=noopener) on a computer, the same tab on a phone, decided by the
//      site's own 1024px layout breakpoint, re-checked at the click. The click
//      never cancels the link, never toggles the city card, and hands the
//      buyer's numbers over with a one-time key: the numbers never go in the
//      address.
//   C. listings.html, run for real in jsdom: it gets city, type and budget
//      from its address and the buyer's numbers from the handover (so the
//      fit badges, monthly costs and bedroom default still work in a new
//      tab), removes the key from the address, and still works when opened
//      directly. The back link closes its own tab, goes back in the same tab,
//      or follows the link.
//
// Needs no server and no network: pages are built from the files on disk
// with their scripts inlined, and fetch is mocked.
//
// Run: node --no-warnings tests/listings_open_in_tab_test.js

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const ORIGIN = "http://localhost:8843";
const PREFIX = "hp_profile_handoff_v1:";
const PROFILE_KEY = "hp_buyer_profile_v1";

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const scriptTag = (src) => `<script>${src.replace(/<\/script/gi, "<\\/script")}</script>`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// An HTML file with every <script src> replaced by the file's contents. A
// script that doesn't exist locally (src/maps-key.js is written at deploy) is
// dropped, the same as a 404.
function inlinePage(file) {
  return read(file).replace(/<script src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    const p = path.join(ROOT, src);
    return fs.existsSync(p) ? scriptTag(fs.readFileSync(p, "utf8")) : "";
  });
}

// The live numbers the results page would have. Distinctive values, so a
// leak into an address would be easy to spot.
const LIVE = { gross: 12345.67, net: 8765.43, dn: 98765, fam: "4", debt: 321, rate: 0.0439 };
const LIVE_JS = `var grossMonthlyIncome=${LIVE.gross}, netMonthlyIncome=${LIVE.net}, dn_selected=${LIVE.dn}, fam_selected='${LIVE.fam}', existingDebt=${LIVE.debt}, firstTimeBuyer=true, canadianResident=true, customMortgageRate=${LIVE.rate};`;

// ---- B. a results-page stand-in: the real ai.js (escapeHtml), buyer-profile.js
// and listings-display.js, with a city card that toggles on click like
// render.js's .city cards.
function resultsPage({ live = true, desktop = true, beforeParse } = {}) {
  const screen = { desktop };
  const html = `<!DOCTYPE html><html><body>
<div class="city" id="card" onclick="window.__cardToggles=(window.__cardToggles||0)+1"></div>
${scriptTag(read("src/ai.js"))}
${live ? scriptTag(LIVE_JS) : ""}
${scriptTag(read("src/buyer-profile.js"))}
${scriptTag(read("src/listings-display.js"))}
</body></html>`;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    url: `${ORIGIN}/calculator.html`, runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: screen.desktop && /\(min-width:\s*1024px\)/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
      if (beforeParse) beforeParse(w);
    },
  });
  const w = dom.window;
  // Draws a link exactly as render.js does: '<a class="view-btn"'+listingsLinkAttrs(...)+'>...</a>'
  const draw = (city, type, budget) => {
    const card = w.document.getElementById("card");
    card.innerHTML = '<a class="view-btn"' + w.listingsLinkAttrs(city, type, budget) + ">View Available Homes in " + w.escapeHtml(city) + "</a>";
    return card.querySelector("a.view-btn");
  };
  const click = (el, init = {}) => el.dispatchEvent(new w.MouseEvent(init.type || "click", { bubbles: true, cancelable: true, button: 0, ...init }));
  const handoffKeys = () => Object.keys(w.localStorage).filter((k) => k.startsWith(PREFIX));
  return { w, screen, errors, draw, click, handoffKeys };
}

// ---- C. listings.html, built from disk, fetch mocked.
const LISTINGS = [
  { listingKey: "G1", listPrice: 600000, city: "Guelph", brokerageName: "Test Realty", photos: [], displayAddress: "1 Test St", bedrooms: 3, bathrooms: 2, propertyType: "condo", listedDate: "2026-09-01" },
  { listingKey: "G2", listPrice: 620000, city: "Guelph", brokerageName: "Test Realty", photos: [], displayAddress: "2 Test St", bedrooms: 3, bathrooms: 2, propertyType: "condo", listedDate: "2026-09-02" },
];
async function listingsPage({ search, referrer, storage = {}, session = {}, sameTabHistory = false, beforeParse } = {}) {
  const calls = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(inlinePage("listings.html"), {
    url: `${ORIGIN}/listings.html${search || ""}`, referrer, runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
      if (sameTabHistory) w.history.pushState(null, "", w.location.href); // a page reached in the same tab has history behind it
      w.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({ listings: LISTINGS }) }; };
      if (beforeParse) beforeParse(w);
    },
  });
  await wait(150);
  const w = dom.window;
  const fetched = calls.length ? new URL(calls[0]).searchParams : null;
  return { w, doc: w.document, calls, fetched, errors };
}
const entry = (profile, handedAt = Date.now()) => JSON.stringify({ handedAt, profile });
const PROFILE = { grossMonthlyIncome: LIVE.gross, netMonthlyIncome: LIVE.net, downPayment: LIVE.dn, familySize: LIVE.fam, existingDebt: LIVE.debt, firstTimeBuyer: true, lttRebateEligible: false, canadianResident: true, mortgageRate: LIVE.rate, savedAt: 1 };
const KEY = "0123456789abcdef0123456789abcdef";
let B_ROUND_TRIP = null; // the address and handover from a real click in B, opened in C

(async () => {
  // =============== A. static ===============
  const displaySrc = read("src/listings-display.js");
  const renderSrc = read("src/render.js");
  const renderSupportSrc = read("src/render-support.js");
  const listingsHtml = read("listings.html");
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

  const popupFiles = ["src/listings-display.js", "src/listing-detail.js", "src/render.js", "src/buyer-profile.js", "listings.html", "listing.html"];
  const popupHits = popupFiles.filter((f) => /window\.open\(|resizeTo|moveTo|\.opener\b|hp_listings|openListingsWindow|ldFillPopupToScreen/.test(code(read(f))));
  check("(A1) no pop-up code left: no window.open, resizeTo/moveTo, window.opener or pop-up helpers in the listings pages and their scripts", popupHits.length === 0, popupHits.join());
  const anywhere = fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => "src/" + f)
    .concat(["index.html", "calculator.html", "listings.html", "listing.html"])
    .filter((f) => /openListingsWindow|ldFillPopupToScreen/.test(read(f)));
  check("(A2) openListingsWindow and ldFillPopupToScreen are gone everywhere (no stale callers)", anywhere.length === 0, anywhere.join());
  check("(A3) render.js: no <button> 'View Available' control left; both are <a class=\"view-btn\"> links built by listingsLinkAttrs",
    !/<button[^>]*class="view-btn"/.test(renderSrc) &&
    renderSrc.includes(`'<a class="view-btn"'+listingsLinkAttrs(x.n,activeProp,displayPrice)+'>View Available `) &&
    renderSrc.includes(`'<a class="view-btn" style="margin-top:12px"'+listingsLinkAttrs(cityName,tp,price)+'>View Available `));
  check("(A4) phone vs computer uses the site's own layout breakpoint (1024px, as in calculator.html's @media(min-width:1024px))",
    /const DESKTOP_BREAKPOINT_PX = 1024;/.test(displaySrc) && /@media\(min-width:1024px\)/.test(read("calculator.html")) &&
    /matchMedia\(`\(min-width: \$\{DESKTOP_BREAKPOINT_PX\}px\)`\)/.test(displaySrc));
  check("(A5) the new tab is opened with target=_blank rel=noopener", /' target="_blank" rel="noopener"'/.test(displaySrc));
  check("(A6) .view-btn CSS is written for a link (display:block, centred, no underline) on both pages that show results",
    ["calculator.html", "index.html"].every((f) => /\.view-btn\{[^}]*display:block;width:100%[^}]*text-align:center[^}]*text-decoration:none/.test(read(f))));
  // Ported from listings_popup_redesign_test.js -- still true of the listings page.
  check("(A7) listings.html loads listings-display.js, ai.js (escapeHtml) and buyer-profile.js, buyer-profile before listings-display",
    /<script src="src\/listings-display\.js"><\/script>/.test(listingsHtml) && /<script src="src\/ai\.js"><\/script>/.test(listingsHtml) &&
    listingsHtml.indexOf('src="src/buyer-profile.js"') > -1 && listingsHtml.indexOf('src="src/buyer-profile.js"') < listingsHtml.indexOf('src="src/listings-display.js"'));
  check("(A8) listings.html reads city and type from its own address (not from a shared app global or window.opener)",
    /new URLSearchParams\(window\.location\.search\)/.test(listingsHtml) && /params\.get\("city"\)/.test(listingsHtml) && /params\.get\("type"\)/.test(listingsHtml) && !/window\.opener/.test(listingsHtml));
  check("(A9) listings.html still has its '← Back to Recommendations' link", /id="backLink"[^>]*>← Back to Recommendations<\/a>/.test(listingsHtml));
  check("(A10) the old inline toggleLiveListings() is not back anywhere", !/toggleLiveListings\(/.test(displaySrc + renderSrc + renderSupportSrc));
  check("(A11) no inline .live-listings-container next to a view-btn in render.js / render-support.js",
    !/class="view-btn"[\s\S]{0,20}live-listings-container/.test(renderSrc) && !/class="view-btn"[\s\S]{0,20}live-listings-container/.test(renderSupportSrc));
  check("(A12) TYPE_LABELS_LOWER has no 'home' fallback (no 'No active home listings')", !/TYPE_LABELS_LOWER\s*=\s*\{[^}]*all:\s*["']home["']/.test(displaySrc));

  // =============== B. the link ===============
  {
    const P = resultsPage({ desktop: true });
    const a = P.draw("Guelph", "condo", 640000);
    check("(B1) computer: plain link to listings.html with city, type and budget", a.getAttribute("href") === "listings.html?city=Guelph&type=condo&budget=640000", a.getAttribute("href"));
    check("(B2) computer: opens in a new tab (target=_blank rel=noopener)", a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener");
    const followed = P.click(a);
    const url = new URL(a.href);
    const key = url.searchParams.get("hp");
    check("(B3) the click never cancels the link", followed === true);
    check("(B4) the click doesn't also open/close the city card it sits in", !P.w.__cardToggles);
    check("(B5) after the click the link still targets a new tab", a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener");
    check("(B6) the link now carries a one-time key (32 hex characters) next to city, type and budget",
      /^[0-9a-f]{32}$/.test(key || "") && url.pathname === "/listings.html" && url.searchParams.get("city") === "Guelph" && url.searchParams.get("type") === "condo" && url.searchParams.get("budget") === "640000", a.href);
    const others = new URL(a.href); others.searchParams.delete("hp");
    check("(B7) nothing personal in the address: only city, type, budget and the key",
      JSON.stringify([...others.searchParams.keys()]) === JSON.stringify(["city", "type", "budget"]) &&
      ![LIVE.gross, LIVE.net, LIVE.dn, LIVE.debt, LIVE.rate].some((v) => others.search.includes(String(v))), a.href);
    const stored = JSON.parse(P.w.localStorage.getItem(PREFIX + key) || "null");
    check("(B8) the buyer's numbers wait under that key for the new tab",
      !!stored && stored.profile.grossMonthlyIncome === LIVE.gross && stored.profile.netMonthlyIncome === LIVE.net && stored.profile.downPayment === LIVE.dn &&
      stored.profile.familySize === LIVE.fam && stored.profile.existingDebt === LIVE.debt && stored.profile.firstTimeBuyer === true && stored.profile.mortgageRate === LIVE.rate &&
      Math.abs(Date.now() - stored.handedAt) < 5000, JSON.stringify(stored));
    check("(B9) ...and are saved for this tab too (sessionStorage), as before", !!P.w.loadBuyerProfile() && P.w.loadBuyerProfile().downPayment === LIVE.dn);
    P.click(a);
    const again = new URL(a.href);
    check("(B10) a second click replaces the key rather than adding another", again.searchParams.getAll("hp").length === 1 && again.searchParams.get("hp") !== key);
    check("(B11) no script errors", P.errors.length === 0, P.errors.join(" | "));
    // Phase C uses this click's real address and handed-over entry: the full round trip.
    B_ROUND_TRIP = { search: again.search, key: again.searchParams.get("hp"), value: P.w.localStorage.getItem(PREFIX + again.searchParams.get("hp")) };
  }
  {
    const P = resultsPage({ desktop: false });
    const a = P.draw("Guelph", "condo", 640000);
    check("(B12) phone: same tab (no target, no rel)", !a.hasAttribute("target") && !a.hasAttribute("rel"));
    const followed = P.click(a);
    check("(B13) phone: the click follows the link in the same tab, with the key, and saves this tab's numbers",
      followed === true && !a.hasAttribute("target") && /^[0-9a-f]{32}$/.test(new URL(a.href).searchParams.get("hp") || "") && P.w.loadBuyerProfile() !== null);
    check("(B14) phone: the card isn't toggled", !P.w.__cardToggles);
  }
  {
    const P = resultsPage({ desktop: true });
    const a = P.draw("Guelph", "all", 700000);
    P.screen.desktop = false; // the window was narrowed after the cards were drawn
    P.click(a);
    check("(B15) drawn on a computer, clicked after narrowing to phone width: same tab", !a.hasAttribute("target") && !a.hasAttribute("rel"));
    P.screen.desktop = true;
    P.click(a);
    check("(B16) ...and widened again: new tab", a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener");
    const before = P.handoffKeys().length;
    const hrefBefore = a.getAttribute("href");
    P.click(a, { type: "auxclick", button: 2 });
    check("(B17) a right click hands nothing over", P.handoffKeys().length === before && a.getAttribute("href") === hrefBefore);
    P.click(a, { type: "auxclick", button: 1 });
    check("(B18) a middle click (opens a new tab) hands the numbers over too", P.handoffKeys().length === before + 1 && a.getAttribute("href") !== hrefBefore);
  }
  {
    const P = resultsPage({ live: false, desktop: true });
    const a = P.draw("Guelph", "condo", 640000);
    const followed = P.click(a);
    check("(B19) before there are results: the link still opens, with no key and nothing stored",
      followed === true && !new URL(a.href).searchParams.has("hp") && P.handoffKeys().length === 0 && P.w.sessionStorage.getItem(PROFILE_KEY) === null);
  }
  {
    const P = resultsPage({
      desktop: true,
      beforeParse(w) {
        const blocked = { get() { throw new Error("SecurityError: storage blocked"); }, configurable: true };
        Object.defineProperty(w, "localStorage", blocked);
        Object.defineProperty(w, "sessionStorage", blocked);
      },
    });
    const a = P.draw("Guelph", "condo", 640000);
    let threw = null, followed = false;
    try { followed = P.click(a); } catch (e) { threw = e; }
    check("(B20) storage blocked (private mode): the link still opens, no key, no error",
      !threw && followed === true && !new URL(a.href).searchParams.has("hp") && P.errors.length === 0, (threw && threw.message) || P.errors.join(" | "));
  }
  {
    const P = resultsPage({ desktop: true });
    const u = (...args) => P.w.listingsPageUrl(...args);
    check("(B21) budget: kept when a positive number (a numeric string too), left out when missing/zero/negative/not a number",
      u("Guelph", "all", undefined) === "listings.html?city=Guelph&type=all" && u("Guelph", "", "640000") === "listings.html?city=Guelph&type=all&budget=640000" &&
      [0, -5, NaN, null, "", "abc", Infinity].every((b) => u("Guelph", "town", b) === "listings.html?city=Guelph&type=town"));
    const t = P.draw("Toronto - Downtown", "condo", 800000);
    check("(B22) a city name with spaces and a dash survives the round trip", new URL(t.href).searchParams.get("city") === "Toronto - Downtown");
    const evil = P.draw('X" onmouseover="alert(1)', "condo", 1);
    check("(B23) quotes in a city name can't break out of the href", evil.getAttribute("onmouseover") === null && new URL(evil.href).searchParams.get("city") === 'X" onmouseover="alert(1)');
  }

  // =============== C. the listings page ===============
  {
    const C = await listingsPage({ search: B_ROUND_TRIP.search, referrer: `${ORIGIN}/calculator.html`, storage: { [PREFIX + B_ROUND_TRIP.key]: B_ROUND_TRIP.value } });
    const w = C.w;
    check("(C1) new tab from the results: page loads with no script errors", C.errors.length === 0, C.errors.join(" | "));
    const p = w.loadBuyerProfile();
    check("(C2) the buyer's numbers arrived (handed over by the click, now in this tab's sessionStorage)",
      !!p && p.grossMonthlyIncome === LIVE.gross && p.netMonthlyIncome === LIVE.net && p.downPayment === LIVE.dn && p.familySize === LIVE.fam && p.existingDebt === LIVE.debt && p.mortgageRate === LIVE.rate, JSON.stringify(p));
    check("(C3) the handed-over entry is deleted once collected", w.localStorage.getItem(PREFIX + B_ROUND_TRIP.key) === null);
    check("(C4) the key is taken out of the address; city, type and budget stay", w.location.search === "?city=Guelph&type=condo&budget=640000", w.location.search);
    check("(C5) the listings request has the city, type and budget from the address and the bedroom minimum from the family size (4 people: 3+)",
      !!C.fetched && C.fetched.get("city") === "Guelph" && C.fetched.get("type") === "condo" && C.fetched.get("budget") === "640000" && C.fetched.get("beds") === "3" && C.fetched.get("sort") === "best",
      C.calls.join());
    check("(C6) cards show the fit badge and the monthly cost (both need the buyer's numbers)",
      C.doc.querySelectorAll(".listing-card").length === 2 && C.doc.querySelectorAll(".listing-card .listing-affordability-badge").length === 2 && C.doc.querySelectorAll(".listing-card .listing-monthly-cost").length === 2);
    check("(C7) the page knows it's first in its own tab", !!(w.history.state && w.history.state.hpOwnTab));
    let closeCalls = 0;
    w.close = () => { closeCalls++; };
    const r1 = w.handleBackClick();
    check("(C8) Back to Recommendations in its own tab: tries to close the tab (the results are in the tab next to it), and follows the link if the browser refuses", closeCalls === 1 && r1 === true);
    let closedNow = false, canFake = true;
    try { Object.defineProperty(w, "closed", { get: () => closedNow, configurable: true }); } catch (e) { canFake = false; }
    w.close = () => { closeCalls++; closedNow = true; };
    const r2 = w.handleBackClick();
    check("(C9) ...and doesn't also follow the link when the tab did close", canFake && r2 === false && closedNow === true);
    const pill = [...C.doc.querySelectorAll(".filter-group .fb")].find((b) => b.textContent === "Townhomes");
    pill.click();
    await wait(50);
    check("(C10) changing the home type updates the address and keeps the own-tab mark", /type=town/.test(w.location.search) && !!(w.history.state && w.history.state.hpOwnTab), w.location.search);
    const logo = C.doc.querySelector(".lp-logo"), back = C.doc.getElementById("backLink");
    check("(C11) the logo and the back link both use the back handler, and fall back to the homepage", /handleBackClick/.test(logo.getAttribute("onclick")) && /handleBackClick/.test(back.getAttribute("onclick")) && back.getAttribute("href") === "https://myhomepilot.ca");
  }
  {
    const C = await listingsPage({ search: `?city=Guelph&type=condo&budget=640000&hp=${KEY}`, referrer: `${ORIGIN}/calculator.html`, storage: { [PREFIX + KEY]: entry(PROFILE) }, sameTabHistory: true });
    const w = C.w;
    check("(C12) same tab (phone): numbers collected, key removed, no errors", !!w.loadBuyerProfile() && !/hp=/.test(w.location.search) && w.localStorage.getItem(PREFIX + KEY) === null && C.errors.length === 0, C.errors.join(" | "));
    check("(C13) same tab: not marked as its own tab", !(w.history.state && w.history.state.hpOwnTab));
    let backs = 0, closes = 0;
    w.history.back = () => { backs++; };
    w.close = () => { closes++; };
    const r = w.handleBackClick();
    check("(C14) Back to Recommendations in the same tab goes back to the results (history.back), not to the homepage", backs === 1 && closes === 0 && r === false);
  }
  {
    const C = await listingsPage({ search: "?city=Guelph" });
    const w = C.w;
    check("(C15) opened directly (no key, no numbers): loads with no errors and shows the listings", C.errors.length === 0 && C.doc.querySelectorAll(".listing-card").length === 2, C.errors.join(" | "));
    check("(C16) opened directly: no fit badge or monthly cost is guessed", C.doc.querySelectorAll(".listing-affordability-badge, .listing-monthly-cost").length === 0);
    check("(C17) opened directly: the request has the city only (all types, no budget, no bedroom minimum, newest first)",
      !!C.fetched && C.fetched.get("city") === "Guelph" && !C.fetched.has("type") && !C.fetched.has("budget") && !C.fetched.has("beds") && C.fetched.get("sort") === "newest", C.calls.join());
    let closes = 0, backs = 0;
    w.close = () => { closes++; }; w.history.back = () => { backs++; };
    check("(C18) opened directly: Back to Recommendations follows its link (to the homepage), it neither closes the tab nor goes back", w.handleBackClick() === true && closes === 0 && backs === 0);
  }
  {
    const C = await listingsPage({ search: `?city=Guelph&type=condo&budget=640000&hp=${KEY}`, referrer: "https://wa.me/", storage: { [PREFIX + KEY]: entry(PROFILE) } });
    check("(C19) arriving from another site is not treated as HomePilot's own tab", !(C.w.history.state && C.w.history.state.hpOwnTab));
  }
  // The live site serves pages without ".html": listing.html?key=X redirects to
  // /listing?key=X, so that is the referrer a listing page leaves behind. A
  // buyer who opened a listing directly (a shared link, or its own tab) and
  // pressed "← Back to listings" must not be sent back to that listing by
  // "← Back to Recommendations" or the logo: both go to the homepage.
  for (const [label, ref] of [["live site, no .html", `${ORIGIN}/listing?key=X1`], ["with .html", `${ORIGIN}/listing.html?key=X1`], ["listings page, no .html", `${ORIGIN}/listings?city=Guelph`]]) {
    const C = await listingsPage({ search: "?city=Guelph", referrer: ref, sameTabHistory: true });
    const w = C.w;
    let backs = 0, closes = 0;
    w.close = () => { closes++; }; w.history.back = () => { backs++; };
    check(`(C25) came from a listing page (${label}): not counted as the results, not marked as its own tab, and Back to Recommendations follows its link to the homepage`,
      w.cameFromResults() === false && !(w.history.state && w.history.state.hpOwnTab) && w.handleBackClick() === true && backs === 0 && closes === 0, ref);
  }
  {
    const C = await listingsPage({ search: `?city=Guelph&type=condo&budget=640000&hp=${KEY}`, referrer: `${ORIGIN}/calculator`, storage: { [PREFIX + KEY]: entry(PROFILE) } });
    check("(C26) the results as the live site serves them (/calculator, no .html) still count: first in its own tab, it is marked as such",
      C.w.cameFromResults() === true && !!(C.w.history.state && C.w.history.state.hpOwnTab));
  }
  {
    const C = await listingsPage({});
    check("(C20) no city in the address: the 'No city specified' message, no request", /No city specified/.test(C.doc.getElementById("listingsRoot").textContent) && C.calls.length === 0);
  }
  {
    const C = await listingsPage({ search: `?city=Guelph&hp=${KEY}`, referrer: `${ORIGIN}/calculator.html`, storage: { [PREFIX + KEY]: entry(PROFILE, Date.now() - 11 * 60 * 1000) } });
    check("(C21) a handover older than 10 minutes is not used, and is deleted", C.w.sessionStorage.getItem(PROFILE_KEY) === null && C.w.localStorage.getItem(PREFIX + KEY) === null && !/hp=/.test(C.w.location.search));
  }
  {
    const C = await listingsPage({ search: "?city=Guelph&hp=..%2F..%2Fsecret", referrer: `${ORIGIN}/calculator.html`, storage: { secret: "keep" } });
    check("(C22) a malformed key is ignored: page works, nothing else in storage is touched", C.errors.length === 0 && C.doc.querySelectorAll(".listing-card").length === 2 && C.w.localStorage.getItem("secret") === "keep" && !/hp=/.test(C.w.location.search));
  }
  {
    const valid = JSON.stringify(PROFILE);
    const C = await listingsPage({ search: `?city=Guelph&hp=${KEY}`, storage: { [PREFIX + KEY]: entry({ ...PROFILE, grossMonthlyIncome: -1 }) }, session: { [PROFILE_KEY]: valid } });
    check("(C23) an invalid handed-over profile is refused and doesn't overwrite this tab's valid one", C.w.sessionStorage.getItem(PROFILE_KEY) === valid && C.w.localStorage.getItem(PREFIX + KEY) === null);
  }
  {
    const fresh = "fedcba9876543210fedcba9876543210";
    const C = await listingsPage({
      search: "?city=Guelph",
      storage: { [PREFIX + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]: entry(PROFILE, Date.now() - 60 * 60 * 1000), [PREFIX + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]: "not json", [PREFIX + fresh]: entry(PROFILE), unrelated: "x" },
    });
    const left = Object.keys(C.w.localStorage).sort();
    check("(C24) numbers nobody collected are swept on the next page load; a fresh handover and unrelated storage are left alone",
      JSON.stringify(left) === JSON.stringify([PREFIX + fresh, "unrelated"].sort()), left.join());
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

