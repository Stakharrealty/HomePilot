// Listing detail page (listing.html) -- the ONE page for a listing, in order:
// HomePilot view, photo gallery, full property details, description, then the
// compliance block. Plus the additive mortgage-engine override, the buyer-
// profile handoff, the card's single "Full HomePilot Analysis" link, and the
// compliance / no-AI rules. (Replaces the old separate listing-full page.)
//
// Same harness as the other frontend tests: jsdom over the local static
// server on :8843 (npx http-server -p 8843 -s), mocked fetch (never touches
// the real Worker), real sessionStorage.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const fmt = (n) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

// ---- the real engine, loaded standalone (same trick the app's own scripts rely on: one shared global scope)
function loadEngine() {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ["src/config.js", "src/cities.js", "src/mortgage.js", "src/closingcosts.js"]) {
    vm.runInContext(read(f).replace(/^const /gm, "var ").replace(/^let /gm, "var "), ctx, { filename: f });
  }
  vm.runInContext("var customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT/100; var firstTimeBuyer = false;", ctx);
  return ctx;
}

// Values recorded from the engine BEFORE the override parameter was added.
// Existing callers (calculator, results page) must keep getting exactly these.
const GOLDEN_CALC = [[["Mississauga",750000,3,150000,"detached"],{"mort":2931,"tax":646,"ins":145,"util":405,"maint":625,"condoFee":0,"total":4752}],[["Mississauga",520000,2,60000,"condo"],{"mort":2553,"tax":448,"ins":48,"util":175,"maint":130,"condoFee":586,"total":3940}],[["Hamilton",640000,4,90000,"semi"],{"mort":3053,"tax":708,"ins":121,"util":395,"maint":480,"condoFee":0,"total":4757}],[["Guelph",560000,1,40000,"town"],{"mort":2912,"tax":574,"ins":90,"util":225,"maint":373,"condoFee":0,"total":4174}],[["Toronto - Downtown",800000,2,200000,"condo"],{"mort":2931,"tax":444,"ins":59,"util":175,"maint":200,"condoFee":904,"total":4713}],[["Toronto - Scarborough",900000,5,180000,"detached"],{"mort":3517,"tax":500,"ins":171,"util":525,"maint":750,"condoFee":0,"total":5463}]];
const GOLDEN_QUAL = [[[90000,150000,500,750000,"detached","Mississauga"],false],[[140000,150000,500,750000,"detached","Mississauga"],true],[[220000,150000,500,750000,"detached","Mississauga"],true],[[90000,60000,500,520000,"condo","Mississauga"],false],[[140000,60000,500,520000,"condo","Mississauga"],true],[[220000,60000,500,520000,"condo","Mississauga"],true],[[90000,90000,500,640000,"semi","Hamilton"],false],[[140000,90000,500,640000,"semi","Hamilton"],false],[[220000,90000,500,640000,"semi","Hamilton"],true],[[90000,40000,500,560000,"town","Guelph"],false],[[140000,40000,500,560000,"town","Guelph"],true],[[220000,40000,500,560000,"town","Guelph"],true],[[90000,200000,500,800000,"condo","Toronto - Downtown"],false],[[140000,200000,500,800000,"condo","Toronto - Downtown"],false],[[220000,200000,500,800000,"condo","Toronto - Downtown"],true],[[90000,180000,500,900000,"detached","Toronto - Scarborough"],false],[[140000,180000,500,900000,"detached","Toronto - Scarborough"],false],[[220000,180000,500,900000,"detached","Toronto - Scarborough"],true]];

const API = "https://homepilot-listings.stakharrealty.workers.dev";
const PROFILE = { grossMonthlyIncome: 15000, netMonthlyIncome: 9800, downPayment: 170000, familySize: "3", existingDebt: 0, firstTimeBuyer: false, mortgageRate: 0.0419, savedAt: 1 };

const BASE = {
  listingKey: "K1", listPrice: 850000, city: "Mississauga", cityRegion: null, brokerageName: "Test Realty Inc.", photos: [],
  displayAddress: "12 Example St", bedrooms: 4, bathrooms: 3, propertyType: "detached", parkingSpaces: 2, parkingTotal: 3,
  basement: "Finished", yearBuilt: 2005, taxAnnualAmount: 4200, taxYear: 2025, heatType: "Forced Air",
  associationFee: null, associationFeeFrequency: null, publicRemarks: "x",
};

async function openPage({ listing, status = 200, profile, budget, search, fetchThrows = false }) {
  const calls = [];
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const qs = search !== undefined ? search : `?key=${listing ? listing.listingKey : "K1"}${budget ? "&budget=" + budget : ""}`;
  const dom = await JSDOM.fromURL("http://localhost:8843/listing.html" + qs, {
    runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (u) => {
        calls.push(String(u));
        if (fetchThrows) throw new Error("network down");
        return { ok: status === 200, status, json: async () => ({ listing }) };
      };
      if (profile !== undefined) w.sessionStorage.setItem("hp_buyer_profile_v1", typeof profile === "string" ? profile : JSON.stringify(profile));
    },
  });
  await new Promise((r) => setTimeout(r, 1800));
  const w = dom.window;
  return { w, doc: w.document, text: w.document.getElementById("ldRoot").textContent, calls, errors, html: w.document.getElementById("ldRoot").innerHTML };
}

(async () => {
  // =============== 1. mortgage engine: additive only ===============
  const eng = loadEngine();
  const market = (n) => eng.M.find((c) => c.n === n);
  let calcSame = true, calcDetail = "";
  for (const [args, want] of GOLDEN_CALC) {
    const got = eng.calcCosts(market(args[0]), args[1], args[2], args[3], args[4]);
    if (JSON.stringify(got) !== JSON.stringify(want)) { calcSame = false; calcDetail += args.join("/") + " "; }
    const gotU = eng.calcCosts(market(args[0]), args[1], args[2], args[3], args[4], undefined);
    const gotEmpty = eng.calcCosts(market(args[0]), args[1], args[2], args[3], args[4], {});
    if (JSON.stringify(gotU) !== JSON.stringify(want) || JSON.stringify(gotEmpty) !== JSON.stringify(want)) { calcSame = false; calcDetail += "(override-less) "; }
  }
  check("calcCosts: existing callers get exactly the pre-change results (6 pinned cases, also with undefined/{} override)", calcSame, calcDetail);
  let qualSame = true;
  for (const [args, want] of GOLDEN_QUAL) if (eng.qualifiesForProperty(...args) !== want || eng.qualifiesForProperty(...args, undefined) !== want) qualSame = false;
  check("qualifiesForProperty: existing callers get exactly the pre-change results (18 pinned cases)", qualSame);

  const m = market("Mississauga");
  const base = eng.calcCosts(m, 750000, 3, 150000, "detached");
  const realTax = eng.calcCosts(m, 750000, 3, 150000, "detached", { taxAnnual: 7200 });
  check("real tax replaces the city-rate estimate ($7,200/yr -> $600/mo)", realTax.tax === 600 && base.tax === 646, `${realTax.tax}/${base.tax}`);
  check("real tax changes only the tax and the total", realTax.mort === base.mort && realTax.ins === base.ins && realTax.util === base.util && realTax.maint === base.maint && realTax.total === base.total + (realTax.tax - base.tax));
  const condoBase = eng.calcCosts(m, 520000, 2, 60000, "condo");
  const condoReal = eng.calcCosts(m, 520000, 2, 60000, "condo", { condoFeeMonthly: 712.4 });
  check("real condo fee replaces the formula fee for condos (rounded)", condoReal.condoFee === 712 && condoBase.condoFee === 586);
  const detachedFee = eng.calcCosts(m, 750000, 3, 150000, "detached", { condoFeeMonthly: 999 });
  check("a condo-fee override is ignored for non-condos", detachedFee.condoFee === 0 && detachedFee.total === base.total);
  const bad = [0, -5, NaN, Infinity, "4200", null, undefined].every((v) => JSON.stringify(eng.calcCosts(m, 750000, 3, 150000, "detached", { taxAnnual: v })) === JSON.stringify(base));
  check("invalid overrides (0, negative, NaN, Infinity, string, null) are ignored", bad);
  check("qualifiesForProperty honours a real tax override (a much higher tax can flip the answer)",
    eng.qualifiesForProperty(140000, 150000, 500, 750000, "detached", "Mississauga") === true &&
    eng.qualifiesForProperty(140000, 150000, 500, 750000, "detached", "Mississauga", { taxAnnual: 30000 }) === false);
  check("qualifiesForProperty honours a real condo fee (lenders count 50%)",
    eng.qualifiesForProperty(90000, 60000, 500, 520000, "condo", "Mississauga", { condoFeeMonthly: 2500 }) === false);

  // =============== 2. static rules ===============
  const detailSrc = read("src/listing-detail.js");
  const profileSrc = read("src/buyer-profile.js");
  const pageSrc = read("listing.html");
  check("no AI / third-party calls in the new modules (Article 6.2(k))",
    !/insights|anthropic|haiku|claude|openai|gpt|XMLHttpRequest|sendBeacon|analytics/i.test(detailSrc.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "") + profileSrc.replace(/\/\/[^\n]*/g, "")));
  check("listing-detail.js makes exactly one network call, to the listings API", (detailSrc.match(/\bfetch\(/g) || []).length === 1 && /fetch\(`\$\{LISTINGS_API_BASE\}\/listing\?key=/.test(detailSrc));
  const scripts = [...pageSrc.matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
  check("listing.html loads only the expected scripts, in order (no leadform / AI / insights modules)",
    JSON.stringify(scripts) === JSON.stringify(["src/config.js", "src/listing-page-globals.js", "src/cities.js", "src/mortgage.js", "src/closingcosts.js", "src/utils.js", "src/i18n.js", "src/explainability.js", "src/ai.js", "src/buyer-profile.js", "src/listings-display.js", "src/listing-fit.js", "src/listing-detail.js"]), scripts.join());
  check("listing.html does NOT touch mortgage.js (Section 1/2's closing-cost + amortization additions were required to leave it untouched)",
    !/(function|const|let)\s+(ldAmortizationMonths|ldComfortPosition|ldClosingCosts|ldNetIncome)\b/.test(read("src/mortgage.js")));
  const scriptsOf = (f) => [...read(f).matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
  const before = (arr, a, b) => arr.indexOf(a) > -1 && arr.indexOf(b) > -1 && arr.indexOf(a) < arr.indexOf(b);
  check("listings.html: globals file after config.js and before mortgage/explainability; fit + profile before listings-display",
    ["src/config.js", "src/listing-page-globals.js", "src/mortgage.js", "src/explainability.js"].every((x, k, a) => k === 0 || before(scriptsOf("listings.html"), a[k - 1], x)) &&
    before(scriptsOf("listings.html"), "src/listing-fit.js", "src/listings-display.js") && before(scriptsOf("listings.html"), "src/buyer-profile.js", "src/listings-display.js") &&
    ["src/cities.js", "src/utils.js", "src/i18n.js"].every((x) => scriptsOf("listings.html").includes(x)));
  check("index.html and calculator.html (which own the engine globals in main.js) load listing-fit + buyer-profile before listings-display, and NEVER the globals file",
    ["index.html", "calculator.html"].every((f) => !scriptsOf(f).includes("src/listing-page-globals.js") && before(scriptsOf(f), "src/buyer-profile.js", "src/listings-display.js") && before(scriptsOf(f), "src/listing-fit.js", "src/listings-display.js")));
  const renderSrc = read("src/render.js");
  check("fit-tier badge colours are the results page's own (render.js fitColor/fitBg)", ["#085041", "#E1F5EE", "#0C447C", "#E6F1FB", "#633806", "#FAEEDA"].every((c) => renderSrc.includes(c)));
  check("the 10% ceiling constants are untouched (server 1.10 and client 1.10)", /const STRETCH_MULTIPLIER = 1\.10;/.test(read("workers/homepilot-listings/src/db.js")) && /const LD_STRETCH_MULTIPLIER = 1\.10;/.test(read("src/listing-fit.js")));
  check("deploy.yml copies listing.html into the deploy folder (and no longer copies listing-full.html)", /cp listing\.html deploy\//.test(read(".github/workflows/deploy.yml")) && !/listing-full/.test(read(".github/workflows/deploy.yml")));
  const display = read("src/listings-display.js");
  const ow = display.slice(display.indexOf("function openListingsWindow("));
  check("openListingsWindow saves the buyer profile before opening the window", ow.indexOf("saveBuyerProfile()") > -1 && ow.indexOf("saveBuyerProfile()") < ow.indexOf("window.open("));
  const hrefLine = display.split(/\r?\n/).find((ln) => ln.includes("const detailHref")) || "";
  check("the detail link is built from the listing key and budget only (no profile data)", /listing\.html\?key=/.test(hrefLine) && !/income|downPayment|profile|debt/i.test(hrefLine), hrefLine);

  // =============== 3. worker: Toronto market name ===============
  const dist = await import(pathToFileURL(path.join(ROOT, "workers", "homepilot-listings", "src", "toronto-districts.js")).href);
  check("regionForCity maps district-coded Toronto rows to the app's Toronto cards",
    dist.regionForCity("Toronto C07") === "Toronto - North York" && dist.regionForCity("Toronto W06") === "Toronto - Etobicoke" &&
    dist.regionForCity("Toronto C01") === "Toronto - Downtown" && dist.regionForCity("Hamilton") === null && dist.regionForCity("Toronto") === null);

  // =============== 4. full page, with profile ===============
  const A = await openPage({ listing: BASE, profile: PROFILE, budget: 900000 });
  const exp = eng.calcCosts(m, 850000, "3", 170000, "detached", { taxAnnual: 4200 });
  const has = (t, s) => t.includes(s);
  check("(A) page loads with no script errors", A.errors.length === 0, A.errors.join(" | "));
  check("(A) fetches only /listing?key= on the listings API", A.calls.length === 1 && A.calls[0] === `${API}/listing?key=K1`, A.calls.join());
  check("(A) shows the listing price", has(A.text, fmt(850000)));
  const sec1 = A.doc.getElementById("ldHomePilot"), sec2 = A.doc.getElementById("ldDetails");
  check("(A) HomePilot view comes BEFORE the property details", !!sec1 && !!sec2 && !!(sec1.compareDocumentPosition(sec2) & 4));
  const t1 = sec1.textContent;
  check("(A) cost rows: Mortgage / Property tax / Insurance / Utilities / Maintenance / Total",
    [["Mortgage", exp.mort], ["Property tax", exp.tax], ["Insurance", exp.ins], ["Utilities", exp.util], ["Maintenance", exp.maint], ["Total per month", exp.total]].every(([l, v]) => has(t1, l + fmt(v))), t1);
  check("(A) real tax is NOT labelled estimated; detached shows no condo fee", !has(t1, "Property tax (estimated)") && !has(t1, "Condo fee"));
  check("(A) take-home and remaining income = net income minus total", has(t1, "Estimated take-home income" + fmt(9800) + "/mo") && has(t1, "Remaining after this home" + fmt(9800 - exp.total) + "/mo"), t1);
  const LBL = { fg: A.w.eval("T.en.fit_great_lbl"), fo: A.w.eval("T.en.fit_good_lbl"), fs: A.w.eval("T.en.fit_stretch_lbl") };
  const tierFor = (ratio) => (ratio < 0.35 ? "fg" : ratio < 0.45 ? "fo" : "fs");
  const badge = sec1.querySelector(".listing-affordability-badge");
  const tierA = tierFor(exp.total / 9800);
  check("(A) verdict is getFit tier for cost vs take-home, with the results-page colour class",
    !!badge && badge.classList.contains("listing-fit-" + tierA) && badge.textContent === LBL[tierA], badge && badge.className + " | " + badge.textContent);
  const factsText = [...sec2.querySelectorAll("li")].map((li) => li.textContent);
  check("(A) details in reading order: Property type, Beds, Baths, Parking spaces, Total parking, Basement, Heating, Year built, Property tax, City",
    JSON.stringify(factsText) === JSON.stringify(["Property type: Detached", "Beds: 4", "Baths: 3", "Parking spaces: 2", "Total parking: 3", "Basement: Finished", "Heating: Forced Air", "Year built: 2005", "Property tax: " + fmt(4200) + "/yr (2025)", "City: Mississauga"]), JSON.stringify(factsText));
  check("(A) not-yet-stored facts are absent, and heating is not called 'heat source'",
    !/square|sq\.? ?ft|utilities included|heat source/i.test(sec2.textContent));
  check("(A) never renders N/A / undefined / null", !/N\/A|undefined|null|NaN/.test(A.text));
  check("(A) brokerage shown in the same style class as the card, with both PROPTX notices verbatim",
    !!A.doc.querySelector(".ld-compliance .listing-brokerage") && has(A.text, "Listed by Test Realty Inc.") &&
    has(A.text, A.w.eval("IDX_NOTICE_RELIABLE")) && has(A.text, A.w.eval("IDX_NOTICE_BONA_FIDE")));
  check("(A) back link points at the city's listings", (A.doc.getElementById("ldBack").getAttribute("href") || "").includes("listings.html?city=Mississauga"));

  // =============== 4b. merged page: gallery + every field + description, one place ===============
  const LONG = "Beautiful family home. " + "Lots of natural light and a renovated kitchen. ".repeat(20) + "THE-VERY-END";
  const FULL = { ...BASE, postalCode: "L5B 1A1", garageType: "Attached", cooling: "Central Air", lotSizeArea: 40, lotSizeUnits: "Feet",
    virtualTourUrl: "https://tour.example.com/k1", publicRemarks: LONG,
    photos: ["https://cdn.example.com/p1.jpg", "https://cdn.example.com/p2.jpg", "https://cdn.example.com/p3.jpg"] };
  const F = await openPage({ listing: FULL, profile: PROFILE, budget: 900000 });
  check("(M0) merged page: no script errors, still exactly one fetch (/listing?key=)", F.errors.length === 0 && F.calls.length === 1 && F.calls[0] === `${API}/listing?key=K1`, F.errors.join(" | ") + F.calls.join());
  const order = ["ldHomePilot", "ldGallery", "ldDetails", "ldRemarks"].map((id) => F.doc.getElementById(id));
  check("(M1) order: HomePilot view -> gallery -> property details -> description -> compliance",
    order.every(Boolean) && order.every((el, i) => i === 0 || !!(order[i - 1].compareDocumentPosition(el) & 4)) && !!(order[3].compareDocumentPosition(F.doc.querySelector(".ld-compliance")) & 4));
  check("(M1b) HomePilot view and gallery share one .ld-top wrapper, HomePilot still first in the DOM (narrow screens keep cost-before-photo)",
    F.doc.getElementById("ldHomePilot").parentElement === F.doc.getElementById("ldGallery").parentElement &&
    F.doc.getElementById("ldHomePilot").parentElement.classList.contains("ld-top") &&
    F.doc.getElementById("ldHomePilot").nextElementSibling === F.doc.getElementById("ldGallery"));
  const listingHtml = read("listing.html");
  check("(M1c) wide-screen CSS swaps the visual order (gallery left, cost view right) without touching the DOM order asserted above",
    /@media\(min-width:760px\)\{[^}]*\.ld-top\{display:flex/.test(listingHtml) &&
    listingHtml.includes(".ld-top>.ld-hp{order:2}") && listingHtml.includes(".ld-top>.ld-gallery{order:1}"));
  // ---- inside a listings popup, the listing page fills the screen (desktop size)
  const stubWin = (o) => { const calls = []; return { calls, w: { opener: { closed: false }, screen: { availWidth: 1920, availHeight: 1080 }, outerWidth: 1040, outerHeight: 840, moveTo: (...a) => calls.push(["moveTo", ...a]), resizeTo: (...a) => calls.push(["resizeTo", ...a]), ...o } }; };
  const P1 = stubWin({});
  check("(P1) inside a popup that is smaller than the screen: moveTo(0,0) then resizeTo(availWidth, availHeight)",
    F.w.ldFillPopupToScreen(P1.w) === true && JSON.stringify(P1.calls) === JSON.stringify([["moveTo", 0, 0], ["resizeTo", 1920, 1080]]), JSON.stringify(P1.calls));
  const P2 = stubWin({ opener: null });
  check("(P2) a normal tab (no opener) is never resized", F.w.ldFillPopupToScreen(P2.w) === false && P2.calls.length === 0);
  const P3 = stubWin({ outerWidth: 1920, outerHeight: 1080 });
  check("(P3) a popup that already fills the screen is left alone", F.w.ldFillPopupToScreen(P3.w) === false && P3.calls.length === 0);
  const P4 = stubWin({ screen: { availWidth: 800, availHeight: 600 }, outerWidth: 500, outerHeight: 400 });
  check("(P4) small screen: floors at 1040x840", F.w.ldFillPopupToScreen(P4.w) === true && P4.calls[1][1] === 1040 && P4.calls[1][2] === 840, JSON.stringify(P4.calls));
  const P5 = stubWin({ moveTo() { throw new Error("blocked"); } });
  check("(P5) a browser that blocks the resize doesn't throw", F.w.ldFillPopupToScreen(P5.w) === false);
  const fullFacts = {
    type: "Property type: Detached", beds: "Beds: 4", baths: "Baths: 3", parking: "Parking spaces: 2", total: "Total parking: 3", garage: "Garage: Attached",
    basement: "Basement: Finished", heating: "Heating: Forced Air", cooling: "Cooling: Central Air", year: "Year built: 2005", lot: "Lot size: 40 Feet",
    tax: `Property tax: ${fmt(4200)}/yr (2025)`, city: "City: Mississauga", postal: "Postal code: L5B 1A1",
  };
  const detailsText = F.doc.getElementById("ldDetails").textContent;
  for (const [k, v] of Object.entries(fullFacts)) check(`(M2) details show ${k}`, detailsText.includes(v), v);
  check("(M2) heating is 'Heating', never 'Heat source'; a non-condo shows no condo/association fee", !/Heat source/i.test(F.text) && !/Condo fee|Association fee/.test(F.text));
  const tour = F.doc.querySelector("a.listing-virtual-tour");
  check("(M3) virtual tour link opens safely in a new tab", !!tour && tour.href === "https://tour.example.com/k1" && tour.target === "_blank" && /noopener/.test(tour.rel));
  const remarks = F.doc.querySelector("#ldRemarks .ld-remarks");
  check("(M4) description is shown in full, untruncated, no Read more toggle", !!remarks && remarks.textContent === LONG && !/Read more/.test(F.text));
  const gimg = F.doc.querySelector("#ldGallery img.listing-photo");
  const gcount = () => F.doc.querySelector("#ldGallery .listing-photo-counter").textContent;
  check("(M5) gallery starts on photo 1 of 3", !!gimg && gimg.src === FULL.photos[0] && gcount() === "1/3");
  F.doc.querySelector("#ldGallery .listing-photo-next").click();
  check("(M5) next arrow shows photo 2 (the card carousel, reused)", gimg.src === FULL.photos[1] && gcount() === "2/3");
  F.doc.querySelector("#ldGallery .listing-photo-next").click(); F.doc.querySelector("#ldGallery .listing-photo-next").click();
  check("(M5) carousel wraps forward to photo 1", gimg.src === FULL.photos[0] && gcount() === "1/3");
  F.doc.querySelector("#ldGallery .listing-photo-prev").click();
  check("(M5) previous arrow wraps to the last photo", gimg.src === FULL.photos[2] && gcount() === "3/3");
  check("(M6) no photos -> 'No photo available', no arrows; no description -> no Description section",
    /No photo available/.test(A.doc.getElementById("ldGallery").textContent) && !A.doc.querySelector(".listing-photo-nav") && !!A.doc.getElementById("ldRemarks") &&
    !(await openPage({ listing: { ...BASE, publicRemarks: "  " }, profile: PROFILE, budget: 900000 })).doc.getElementById("ldRemarks"));
  const XS2 = await openPage({ listing: { ...BASE, publicRemarks: "<script>alert(3)</script>", virtualTourUrl: "javascript:alert(4)", photos: ["javascript:alert(5)", "https://cdn.example.com/ok.jpg"] }, profile: PROFILE, budget: 900000 });
  check("(M7) hostile description / tour / photo URLs render inert: no script, no javascript: links, https photo kept",
    XS2.doc.querySelectorAll("#ldRoot script").length === 0 && !XS2.doc.querySelector("a.listing-virtual-tour") && XS2.doc.querySelector("img.listing-photo").src === "https://cdn.example.com/ok.jpg");
  check("(M8) listing-full page and script are gone, and nothing points at them",
    !fs.existsSync(path.join(ROOT, "listing-full.html")) && !fs.existsSync(path.join(ROOT, "src", "listing-full.js")) && !/listing-full/.test(read(".github/workflows/deploy.yml")) &&
    !/listing-full/.test(read("package.json")) && !/listing-full/.test(read("src/listings-display.js")));
  check("(M9) the deferred (not-yet-stored) fields are not on the page; no lat/long, no listingUrl",
    // square footage (LivingAreaRange) and building age (ApproximateAge) were
    // deferred when this check was written -- both are now implemented and
    // real (migration 0005, 2026-09-22, confirmed via live PropTx field
    // investigation), so they're deliberately no longer in this forbidden list.
    !/room size|utilities included|inclusion|exclusion|days on market|frontage|architectural|sewer|latitude|longitude|listingUrl/i.test(detailSrc.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")));
  check("(M10) reuses the shared helpers instead of reimplementing them",
    /attachPhotoCarousel\(/.test(detailSrc) && /moneyFactOrEstimate\(/.test(detailSrc) && /factOrOmit\(/.test(detailSrc) && !/function (ldEstimates|factOrOmit|moneyFactOrEstimate|attachPhotoCarousel)\b/.test(detailSrc));

  // =============== 5. estimated vs real ===============
  const B = await openPage({ listing: { ...BASE, taxAnnualAmount: null, taxYear: null }, profile: PROFILE, budget: 900000 });
  const expB = eng.calcCosts(m, 850000, "3", 170000, "detached");
  check("(B) no real tax -> engine estimate, labelled (estimated), in both sections",
    has(B.doc.getElementById("ldHomePilot").textContent, "Property tax (estimated)" + fmt(expB.tax)) &&
    has(B.doc.getElementById("ldDetails").textContent, "Property tax (estimated): " + fmt(Math.round(850000 * m.tx)) + "/yr"));

  const CONDO = { ...BASE, listingKey: "C1", listPrice: 520000, propertyType: "condo", associationFee: 612, associationFeeFrequency: "Monthly", taxAnnualAmount: 2900 };
  const C1 = await openPage({ listing: CONDO, profile: PROFILE, budget: 600000 });
  const expC = eng.calcCosts(m, 520000, "3", 170000, "condo", { taxAnnual: 2900, condoFeeMonthly: 612 });
  check("(C1) condo with a real fee: 'Condo fee' row with the real amount, not estimated",
    has(C1.doc.getElementById("ldHomePilot").textContent, "Condo fee" + fmt(612)) && !has(C1.text, "Condo fee (estimated)") && expC.condoFee === 612);
  check("(C1) details show the real condo fee", has(C1.doc.getElementById("ldDetails").textContent, "Condo fee: " + fmt(612) + "/mo"));
  const C2 = await openPage({ listing: { ...CONDO, associationFee: null, associationFeeFrequency: null }, profile: PROFILE, budget: 600000 });
  const expC2 = eng.calcCosts(m, 520000, "3", 170000, "condo", { taxAnnual: 2900 });
  check("(C2) condo with no fee: labelled estimate from the engine formula",
    has(C2.doc.getElementById("ldHomePilot").textContent, "Condo fee (estimated)" + fmt(expC2.condoFee)) && has(C2.doc.getElementById("ldDetails").textContent, "Condo fee (estimated): " + fmt(expC2.condoFee) + "/mo"));
  const C3 = await openPage({ listing: { ...CONDO, associationFee: 6000, associationFeeFrequency: "Annually" }, profile: PROFILE, budget: 600000 });
  check("(C3) an annual fee is converted to monthly ($6,000/yr -> $500/mo)", has(C3.doc.getElementById("ldHomePilot").textContent, "Condo fee" + fmt(500)) && !has(C3.text, "Condo fee (estimated)"));
  const C4 = await openPage({ listing: { ...CONDO, associationFee: 600, associationFeeFrequency: "Fortnightly" }, profile: PROFILE, budget: 600000 });
  check("(C4) an unrecognised fee frequency is not guessed: falls back to the labelled estimate", has(C4.text, "Condo fee (estimated)"));

  // =============== 6. verdicts: 10% ceiling first, then getFit() tier ===============
  check("(D0) labels come from i18n: 'Great fit' / 'Good Fit' / 'Stretch'", LBL.fg === "Great fit" && LBL.fo === "Good Fit" && LBL.fs === "Stretch", JSON.stringify(LBL));
  const tierPages = {};
  for (const [want, ratio] of [["fg", 0.30], ["fo", 0.40], ["fs", 0.50]]) {
    const net = exp.total / ratio;
    const pg = await openPage({ listing: BASE, profile: { ...PROFILE, netMonthlyIncome: net }, budget: 900000 });
    tierPages[want] = { pg, net };
    const tb = pg.doc.querySelector("#ldHomePilot .listing-affordability-badge");
    check(`(D1-${want}) housing cost at ${Math.round(ratio * 100)}% of take-home -> "${LBL[want]}" badge (getFit tier, results-page colours)`,
      !!tb && tb.classList.contains("listing-fit-" + want) && tb.textContent === LBL[want], tb && tb.className + " | " + tb.textContent);
  }
  const inside = await openPage({ listing: BASE, profile: PROFILE, budget: 800000 });
  const ib = inside.doc.querySelector("#ldHomePilot .listing-affordability-badge");
  check("(D2) over the shown budget but inside the 10% ceiling -> a fit tier, no longer the old 'Stretch Option'",
    !!ib && /listing-fit-f[gos]/.test(ib.className) && !/Stretch Option|Within Budget/.test(inside.text));
  const edgeIn = await openPage({ listing: BASE, profile: PROFILE, budget: 772728 }); // 772728 x 1.10 = 850000.8 >= 850000
  const edgeOut = await openPage({ listing: BASE, profile: PROFILE, budget: 772727 }); // 772727 x 1.10 = 849999.7 <  850000
  check("(D3) exactly inside the 10% ceiling -> badge", !!edgeIn.doc.querySelector("#ldHomePilot .listing-affordability-badge"));
  check("(D3) $1 past the 10% ceiling -> NO badge (ceiling unchanged), costs and remaining income still shown",
    !edgeOut.doc.querySelector("#ldHomePilot .listing-affordability-badge") && has(edgeOut.text, "Total per month") && has(edgeOut.text, "Remaining after this home"));
  const O = await openPage({ listing: BASE, profile: PROFILE, budget: 500000 });
  check("(D4) far past the ceiling -> no badge", !O.doc.querySelector("#ldHomePilot .listing-affordability-badge") && has(O.text, "Remaining after this home"));
  const NB = await openPage({ listing: BASE, profile: PROFILE });
  check("(D5) no budget in the URL -> no badge, costs still shown", !NB.doc.querySelector("#ldHomePilot .listing-affordability-badge") && has(NB.text, "Total per month"));

  // ---- the listing CARD (listings.html) must show the identical badge
  const cvc = new VirtualConsole(); const cerrors = []; cvc.on("jsdomError", (e) => { if (!/maps-key.js/.test(e.message)) cerrors.push(e.message); }); // maps-key.js is generated at deploy time; the page handles its absence
  const cardDom = await JSDOM.fromURL("http://localhost:8843/listings.html?city=Mississauga", {
    runScripts: "dangerously", resources: "usable", virtualConsole: cvc, pretendToBeVisual: true,
    beforeParse(w) { w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ listings: [], count: 0 }) }); },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const cw = cardDom.window;
  check("(K0) listings.html loads with the engine scripts and no script errors", cerrors.length === 0 && typeof cw.listingFit === "function", cerrors.join(" | "));
  const cardBadge = (profile, budget, listing = BASE) => {
    cw.sessionStorage.clear();
    if (profile) cw.sessionStorage.setItem("hp_buyer_profile_v1", JSON.stringify(profile));
    const b = cw.renderListingCard(listing, budget).querySelector(".listing-affordability-badge");
    return b ? { cls: b.className, text: b.textContent } : null;
  };
  for (const want of ["fg", "fo", "fs"]) {
    const { pg, net } = tierPages[want];
    const detail = pg.doc.querySelector("#ldHomePilot .listing-affordability-badge");
    const card = cardBadge({ ...PROFILE, netMonthlyIncome: net }, 900000);
    check(`(K1-${want}) card badge is identical to the detail-page badge ("${LBL[want]}")`,
      !!card && !!detail && card.text === detail.textContent && card.cls.includes("listing-fit-" + want) && detail.className.includes("listing-fit-" + want), JSON.stringify(card));
  }
  check("(K2) card: no buyer profile -> no badge (never a guessed one)", cardBadge(null, 900000) === null);
  check("(K3) card: no budget -> no badge", cardBadge(PROFILE, undefined) === null && cardBadge(PROFILE, 0) === null);
  check("(K4) card: past the 10% ceiling -> no badge; exactly inside -> badge", cardBadge(PROFILE, 772727) === null && cardBadge(PROFILE, 772728) !== null);
  check("(K5) card badge label is escaped text from i18n", cardBadge(PROFILE, 900000).text === LBL[tierFor(exp.total / 9800)]);

  // =============== 7. no profile / bad profile ===============
  const N = await openPage({ listing: BASE });
  check("(E1) no profile: shows the price and a prompt, no cost table, no remaining income, no badge",
    has(N.text, fmt(850000)) && has(N.text, "enter your income") && !has(N.text, "Total per month") && !has(N.text, "Remaining after") && !N.doc.querySelector(".listing-affordability-badge"));
  check("(E1) no profile: details, gallery and compliance block still render", !!N.doc.getElementById("ldDetails") && !!N.doc.getElementById("ldGallery") && has(N.text, "Listed by Test Realty Inc."));
  for (const [label, p] of [["negative income", { ...PROFILE, grossMonthlyIncome: -5 }], ["garbage JSON", "{not json"], ["string income", { ...PROFILE, grossMonthlyIncome: "lots" }], ["absurd down payment", { ...PROFILE, downPayment: 1e15 }], ["family size 0", { ...PROFILE, familySize: "0" }]]) {
    const G = await openPage({ listing: BASE, profile: p, budget: 900000 });
    check(`(E2) invalid stored profile (${label}) is ignored -> no-profile fallback`, !has(G.text, "Total per month") && has(G.text, "enter your income"));
  }

  // =============== 8. Toronto ===============
  const TOR = { ...BASE, listingKey: "T1", city: "Toronto C07", cityRegion: "Toronto - North York", listPrice: 900000, taxAnnualAmount: null };
  const T = await openPage({ listing: TOR, profile: PROFILE, budget: 950000 });
  const expT = eng.calcCosts(market("Toronto - North York"), 900000, "3", 170000, "detached");
  const dtIns = eng.calcCosts(market("Toronto - Downtown"), 900000, "3", 170000, "detached").ins;
  check("(F) Toronto district row uses its sub-region market record (North York insurance, not Downtown)", has(T.doc.getElementById("ldHomePilot").textContent, "Insurance" + fmt(expT.ins)) && expT.ins !== dtIns, expT.ins + " vs " + dtIns);
  check("(F) Toronto back link goes to the Toronto sub-region listings", (T.doc.getElementById("ldBack").getAttribute("href") || "").includes("city=Toronto%20-%20North%20York"));
  const UNK = await openPage({ listing: { ...BASE, listingKey: "U1", city: "Nowhereville" }, profile: PROFILE, budget: 900000 });
  check("(F2) a city the app has no record for still renders a full estimate (default rates)", has(UNK.text, "Total per month") && UNK.errors.length === 0, UNK.errors.join());

  // =============== 9. bare listing / errors ===============
  const BARE = { listingKey: "B1", listPrice: 500000, city: "Mississauga", brokerageName: null, photos: [], propertyType: null };
  const R = await openPage({ listing: BARE, profile: PROFILE, budget: 600000 });
  const rf = [...R.doc.querySelectorAll("#ldDetails li")].map((li) => li.textContent);
  check("(G) bare listing: details list only what exists (the tax estimate and city), no N/A / undefined / null", rf.length === 2 && rf[0].startsWith("Property tax (estimated)") && rf[1] === "City: Mississauga" && !/N\/A|undefined|null|NaN/.test(R.text.replace("Brokerage not available", "")), JSON.stringify(rf));
  check("(G) bare listing shows the brokerage fallback wording", has(R.text, "Listed by Brokerage not available"));
  const NF = await openPage({ listing: null, status: 404 });
  check("(H1) unknown/removed listing -> friendly message, no crash", has(NF.text, "no longer available") && NF.errors.length === 0);
  const NK = await openPage({ listing: null, search: "" });
  check("(H2) no key in the URL -> message and no API call", has(NK.text, "No listing specified") && NK.calls.length === 0);
  const NE = await openPage({ listing: null, fetchThrows: true });
  check("(H3) network failure -> friendly message, no crash", has(NE.text, "Couldn't load this listing") && NE.errors.length === 0);
  const XS = await openPage({ listing: { ...BASE, displayAddress: "<img src=x onerror=alert(1)>", brokerageName: "<script>alert(1)</script>", basement: "<b>x</b>" }, profile: PROFILE, budget: 900000 });
  check("(H4) HTML in listing fields is escaped, not rendered", XS.doc.querySelectorAll("#ldRoot img, #ldRoot script, #ldRoot li b").length === 0);

  // =============== 10. handoff + card link (on the main app page) ===============
  const vc = new VirtualConsole();
  const dom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const w = dom.window;
  w.sessionStorage.clear();
  check("(I1) nothing is saved before the buyer has results", w.saveBuyerProfile() === false && w.loadBuyerProfile() === null);
  w.eval("grossMonthlyIncome=15000; netMonthlyIncome=9800; dn_selected=170000; fam_selected='3'; existingDebt=250; firstTimeBuyer=true; customMortgageRate=0.0439;");
  check("(I2) saveBuyerProfile stores the live numbers", w.saveBuyerProfile() === true);
  const back = w.loadBuyerProfile();
  check("(I3) loadBuyerProfile round-trips them", back && back.grossMonthlyIncome === 15000 && back.netMonthlyIncome === 9800 && back.downPayment === 170000 && back.familySize === "3" && back.existingDebt === 250 && back.firstTimeBuyer === true && back.mortgageRate === 0.0439, JSON.stringify(back));
  check("(I4) saved under sessionStorage (not localStorage)", !!w.sessionStorage.getItem("hp_buyer_profile_v1") && !w.localStorage.getItem("hp_buyer_profile_v1"));
  const card = w.renderListingCard({ listingKey: "W123", listPrice: 700000, city: "Mississauga", brokerageName: "B", photos: [] }, 725000);
  const link = card.querySelector("a.listing-detail-link");
  check("(J1) card has one 'Full HomePilot Analysis' link to listing.html with the key and shown budget", !!link && link.textContent === "Full HomePilot Analysis" && card.querySelectorAll(".listing-links a").length === 1 && link.getAttribute("href") === "listing.html?key=W123&budget=725000", link && link.getAttribute("href"));
  check("(J2) link navigates in the same window (no target/noopener, which would drop sessionStorage)", !link.hasAttribute("target") && !link.hasAttribute("rel"));
  check("(J3) link carries no personal data", !/income|down|debt/i.test(link.getAttribute("href")));
  const noBudget = w.renderListingCard({ listingKey: "W124", listPrice: 1, city: "X", brokerageName: "B", photos: [] });
  check("(J4) no budget -> link without a budget param", noBudget.querySelector("a.listing-detail-link").getAttribute("href") === "listing.html?key=W124");
  const evil = w.renderListingCard({ listingKey: 'x"><script>alert(1)</script>', listPrice: 1, city: "X", brokerageName: "B", photos: [] }, 1);
  check("(J5) an unsafe listing key produces no link at all", !evil.querySelector("a.listing-detail-link"));

  // ---- computing a card's badge must not disturb the main app's live state
  w.eval("netMonthlyIncome = 1234; customMortgageRate = 0.0777; firstTimeBuyer = true;");
  w.sessionStorage.setItem("hp_buyer_profile_v1", JSON.stringify(PROFILE)); // profile rate 4.19% / not first-time: differs from the live values
  const idxBadge = w.renderListingCard(BASE, 900000).querySelector(".listing-affordability-badge");
  check("(L1) index.html cards get the fit-tier badge too", !!idxBadge && /listing-fit-f[gos]/.test(idxBadge.className), idxBadge && idxBadge.className);
  check("(L2) computing it leaves the live app's rate / net income / first-time-buyer values exactly as they were",
    w.eval("netMonthlyIncome") === 1234 && w.eval("customMortgageRate") === 0.0777 && w.eval("firstTimeBuyer") === true, w.eval("[netMonthlyIncome, customMortgageRate, firstTimeBuyer]").join());

  // =============== 11. Section 1/2/3/4 additions: cash-to-purchase, mortgage assumptions, % of income, comfort position ===============
  const ccBase = eng.calcClosingCosts("Mississauga", 850000, false);
  const A2 = await openPage({ listing: BASE, profile: PROFILE, budget: 900000 });
  const hp2 = A2.doc.getElementById("ldHomePilot").textContent;
  check("(N1) Estimated cash required to purchase: Ontario (non-Toronto) property, non-FTB -- LTT and total match calcClosingCosts exactly",
    has(hp2, "Ontario land transfer tax" + fmt(ccBase.ltt.provNet)) &&
    has(hp2, "Estimated cash required to purchase" + fmt(170000 + ccBase.total)) &&
    !has(hp2, "Toronto municipal land transfer tax") && !has(hp2, "land transfer tax rebate"), hp2);
  check("(N2) closing-cost line items (legal fees, title insurance, home inspection, moving, adjustments) match the engine exactly",
    has(hp2, "Legal fees (estimated)" + fmt(ccBase.legal)) && has(hp2, "Title insurance (estimated)" + fmt(ccBase.titleIns)) &&
    has(hp2, "Home inspection (estimated)" + fmt(ccBase.inspection)) && has(hp2, "Moving costs (estimated)" + fmt(ccBase.moving)) &&
    has(hp2, "Closing adjustments (estimated)" + fmt(ccBase.adjustments)));
  check("(N3) down payment row in the purchase-cost section shows the buyer's real down payment", has(hp2, "Down payment" + fmt(170000)));

  const ccTor = eng.calcClosingCosts("Toronto - North York", 900000, false);
  const T2 = await openPage({ listing: TOR, profile: PROFILE, budget: 950000 });
  const hpT2 = T2.doc.getElementById("ldHomePilot").textContent;
  check("(N4) Toronto property: municipal LTT row appears with the correct amount, on top of the provincial LTT",
    has(hpT2, "Ontario land transfer tax" + fmt(ccTor.ltt.provNet)) && has(hpT2, "Toronto municipal land transfer tax" + fmt(ccTor.ltt.muniNet)) &&
    ccTor.isToronto === true, hpT2);

  const FTB_PROFILE = { ...PROFILE, firstTimeBuyer: true };
  const ccFTB = eng.calcClosingCosts("Mississauga", 850000, true);
  const FT = await openPage({ listing: BASE, profile: FTB_PROFILE, budget: 900000 });
  const hpFT = FT.doc.getElementById("ldHomePilot").textContent;
  check("(N5) first-time buyer: LTT rebate row shown with the correct amount, and it actually lowers the net LTT vs. the non-FTB case",
    has(hpFT, "First-time buyer land transfer tax rebate-" + fmt(ccFTB.ltt.totalRebate)) &&
    ccFTB.ltt.totalRebate > 0 && ccFTB.ltt.provNet < ccBase.ltt.provNet, hpFT);
  check("(N6) non-first-time buyer: no rebate row at all", !has(hp2, "land transfer tax rebate"));
  check("(N7) first-time buyer's total cash required is lower than the non-FTB total at the identical price (rebate reduces it)",
    (170000 + ccFTB.total) < (170000 + ccBase.total));

  // 170000/850000 = 0.20 exactly -> the existing dpRatio>=0.20 rule (mortgage.js) already gives this
  // scenario 30-year amortization (also reflected in calcCosts' own "exp.mort" used elsewhere above).
  check("(N8) mortgage assumptions line shows the profile's rate, its correct amortization, and its down payment",
    has(hp2, "Mortgage assumptions: 4.19% rate · 30-year amortization · " + fmt(170000) + " down"));
  const FTB_LOWDOWN = { ...PROFILE, firstTimeBuyer: true, downPayment: 20000 };
  const LD = await openPage({ listing: { ...BASE, listPrice: 300000 }, profile: FTB_LOWDOWN, budget: 400000 });
  check("(N9) first-time buyer with <20% down still gets 30-year amortization (matches mortgage.js's own eligibility rule)",
    has(LD.doc.getElementById("ldHomePilot").textContent, "30-year amortization"));
  const NONFTB_LOWDOWN = { ...PROFILE, firstTimeBuyer: false, downPayment: 20000 };
  const LD2 = await openPage({ listing: { ...BASE, listPrice: 300000 }, profile: NONFTB_LOWDOWN, budget: 400000 });
  check("(N10) non-first-time buyer with <20% down gets 25-year amortization",
    has(LD2.doc.getElementById("ldHomePilot").textContent, "25-year amortization"));

  const pct = Math.round((exp.total / 9800) * 100);
  check("(N11) housing cost as % of take-home income matches total/net, rounded, and appears even with a budget present",
    has(hp2, "Housing cost as % of take-home income" + pct + "%"));
  const NBpct = await openPage({ listing: BASE, profile: PROFILE }); // no budget param at all
  check("(N12) % of take-home income still shows with no budget URL param (doesn't depend on the fit badge)",
    has(NBpct.doc.getElementById("ldHomePilot").textContent, "Housing cost as % of take-home income" + pct + "%"));

  // Comfort position -- all three states, derived from calcBP() itself (never hand-picked numbers)
  const bpVals = eng.calcBP(180000, 170000, 0); // matches PROFILE: grossMonthlyIncome 15000 x 12, downPayment 170000, existingDebt 0, rate/FTB = loadEngine's defaults (4.19%, non-FTB) = PROFILE's own values
  check("(N13) sanity: comfortBP is below bp (precondition for the mid-point scenario below)", bpVals.comfortBP < bpVals.bp);
  const withinPrice = Math.round(bpVals.comfortBP * 0.7);
  const aboveComfortPrice = Math.round((bpVals.comfortBP + bpVals.bp) / 2);
  const aboveBankPrice = bpVals.bp + 100000;
  const CW = await openPage({ listing: { ...BASE, listPrice: withinPrice }, profile: PROFILE });
  const CA = await openPage({ listing: { ...BASE, listPrice: aboveComfortPrice }, profile: PROFILE });
  const CB = await openPage({ listing: { ...BASE, listPrice: aboveBankPrice }, profile: PROFILE });
  check("(N14) price within comfort range -> the comfort-range sentence",
    has(CW.doc.getElementById("ldHomePilot").textContent, "This home is within your comfort affordability range."));
  check("(N15) price above comfort range but within the bank ceiling -> the in-between sentence",
    has(CA.doc.getElementById("ldHomePilot").textContent, "though still within what a lender would likely qualify you for"));
  check("(N16) price above the bank ceiling -> the over-ceiling sentence",
    has(CB.doc.getElementById("ldHomePilot").textContent, "This home is above what HomePilot's calculator estimates you would qualify for."));
  const comfortText = (CW.doc.querySelector(".ld-comfort") || {}).textContent || "";
  check("(N17) the comfort-position sentence shows no dollar figure at all (no maximum-affordability number, by product decision)",
    comfortText.length > 0 && !comfortText.includes("$"));
  check("(N18) comfort sentence renders with no budget URL param at all (independent of the fit badge/ceiling)",
    has(NBpct.doc.getElementById("ldHomePilot").textContent, "comfort affordability range") || has(NBpct.text, "qualify you for"));

  // Missing / incomplete buyer profile -- the new sections must not appear at all, never partially or with guessed numbers
  check("(N19) no profile: none of the new sections render (no cash-required, no mortgage assumptions, no comfort sentence, no % of income)",
    !has(N.text, "Estimated cash required to purchase") && !has(N.text, "Mortgage assumptions") && !has(N.text, "comfort affordability range") && !has(N.text, "Housing cost as %"));
  for (const [label, p] of [["negative income", { ...PROFILE, grossMonthlyIncome: -5 }], ["garbage JSON", "{not json"], ["absurd down payment", { ...PROFILE, downPayment: 1e15 }]]) {
    const G2 = await openPage({ listing: BASE, profile: p, budget: 900000 });
    check(`(N20) invalid stored profile (${label}) -> new sections also fall back cleanly (no half-rendered cash-required/comfort content)`,
      !has(G2.text, "Estimated cash required to purchase") && !has(G2.text, "comfort affordability range"));
  }

  // Never invented / NaN figures anywhere in the new sections
  check("(N21) new sections never render N/A / undefined / null / NaN",
    !/N\/A|undefined|null|NaN/.test(hp2) && !/N\/A|undefined|null|NaN/.test(hpT2) && !/N\/A|undefined|null|NaN/.test(hpFT));

  // Existing monthly-cost values are still byte-for-byte unchanged (calcCosts itself untouched -- see GOLDEN_CALC above; this re-confirms at the page level)
  check("(N22) existing monthly cost rows are unchanged by this pass (still match calcCosts exactly, same as check (A) above)",
    has(hp2, "Mortgage" + fmt(exp.mort)) && has(hp2, "Total per month" + fmt(exp.total)));

  // =============== 12. lot size (LotWidth/LotDepth), square footage (LivingAreaRange), building age (ApproximateAge) ===============
  // Confirmed via a live PropTx field investigation (2026-09-22): LotWidth/LotDepth are the reliable lot-size fields
  // (100% populated on lot-bearing types vs. the old lotSizeArea's 11%); LivingAreaRange is the correct (range-only)
  // square-footage field; ApproximateAge is the correct (range-only) building-age field (YearBuilt confirmed 0% live).
  const LOT_WD = await openPage({ listing: { ...BASE, lotWidth: 75.07, lotDepth: 150, lotSizeArea: 11260.5, lotSizeUnits: "Feet" }, profile: PROFILE, budget: 900000 });
  check("(O1) lot size prefers width x depth when both are present", has(LOT_WD.doc.getElementById("ldDetails").textContent, "Lot size: 75.07 x 150 ft"));
  check("(O1b) width x depth format does not also show the old lotSizeArea format", !has(LOT_WD.text, "Lot size: 11260.5"));

  const LOT_FALLBACK = await openPage({ listing: { ...BASE, lotWidth: null, lotDepth: null, lotSizeArea: 30, lotSizeUnits: "Feet" }, profile: PROFILE, budget: 900000 });
  check("(O2) lot size falls back to the old lotSizeArea format when width/depth are both absent", has(LOT_FALLBACK.doc.getElementById("ldDetails").textContent, "Lot size: 30 Feet"));

  const LOT_PARTIAL = await openPage({ listing: { ...BASE, lotWidth: 50, lotDepth: null, lotSizeArea: 30, lotSizeUnits: "Feet" }, profile: PROFILE, budget: 900000 });
  check("(O3) only one of width/depth present -> falls back to lotSizeArea, not a half-formed 'x' row", has(LOT_PARTIAL.doc.getElementById("ldDetails").textContent, "Lot size: 30 Feet") && !/Lot size: 50 x/.test(LOT_PARTIAL.text));

  const LOT_CONDO = await openPage({ listing: { ...BASE, propertyType: "condo", lotWidth: null, lotDepth: null, lotSizeArea: null, lotSizeUnits: null }, profile: PROFILE, budget: 900000 });
  check("(O4) condo with no lot data: 'Lot size' row omitted entirely (not '0 x 0', not blank)", !has(LOT_CONDO.text, "Lot size"));

  const SIZE_YES = await openPage({ listing: { ...BASE, livingAreaRange: "3000-3500" }, profile: PROFILE, budget: 900000 });
  check("(O5) square footage shows the range verbatim with ' sq ft' suffix", has(SIZE_YES.doc.getElementById("ldDetails").textContent, "Size: 3000-3500 sq ft"));

  const SIZE_UNDER = await openPage({ listing: { ...BASE, livingAreaRange: "< 700" }, profile: PROFILE, budget: 900000 });
  check("(O6) square footage handles the '< 700' bucket format verbatim", has(SIZE_UNDER.doc.getElementById("ldDetails").textContent, "Size: < 700 sq ft"));

  const SIZE_NO = await openPage({ listing: { ...BASE, livingAreaRange: null }, profile: PROFILE, budget: 900000 });
  check("(O7) no LivingAreaRange -> 'Size' row omitted entirely, no blank/N-A", !has(SIZE_NO.text, "Size:"));

  const AGE_RANGE = await openPage({ listing: { ...BASE, approximateAge: "16-30" }, profile: PROFILE, budget: 900000 });
  check("(O8) building age shows the range with ' years' suffix", has(AGE_RANGE.doc.getElementById("ldDetails").textContent, "Building age: 16-30 years"));

  const AGE_NEW = await openPage({ listing: { ...BASE, approximateAge: "New" }, profile: PROFILE, budget: 900000 });
  check("(O9) building age 'New' has NO 'years' suffix", has(AGE_NEW.doc.getElementById("ldDetails").textContent, "Building age: New") && !has(AGE_NEW.text, "New years"));

  const AGE_NO = await openPage({ listing: { ...BASE, approximateAge: null }, profile: PROFILE, budget: 900000 });
  check("(O10) no ApproximateAge -> 'Building age' row omitted entirely", !has(AGE_NO.text, "Building age"));

  check("(O11) new facts never render N/A / undefined / null / NaN across all these scenarios",
    [LOT_WD, LOT_FALLBACK, LOT_PARTIAL, LOT_CONDO, SIZE_YES, SIZE_UNDER, SIZE_NO, AGE_RANGE, AGE_NEW, AGE_NO]
      .every((p) => !/N\/A|undefined|null|NaN/.test(p.text)));

  // XSS: hostile values in the new PropTx-sourced fields must render inert (escaped), matching the existing (H4) pattern
  const XS3 = await openPage({
    listing: { ...BASE, livingAreaRange: "<img src=x onerror=alert(1)>", approximateAge: "<script>alert(2)</script>", lotWidth: "<b>50</b>", lotDepth: 100 },
    profile: PROFILE, budget: 900000,
  });
  check("(O12) hostile LivingAreaRange/ApproximateAge/LotWidth values are escaped, not rendered as HTML",
    XS3.doc.querySelectorAll("#ldRoot script, #ldRoot img, #ldRoot b").length === 0);

  // Untouched by this pass: fit badge, monthly total, card, closing costs, comfort position, mortgage assumptions
  check("(O13) the fit badge and monthly 'Total per month' are unaffected by the new facts (still match calcCosts exactly)",
    has(LOT_WD.doc.getElementById("ldHomePilot").textContent, "Total per month" + fmt(exp.total)));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
