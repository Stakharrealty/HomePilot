// Homepage claims: nothing the product doesn't back up, in any language.
// IMPROVEMENT_PLAN.md 1.3 (REVIEW_BACKLOG.md P0-4).
//
// The homepage claimed "real GO Transit schedules", a commute toggle between
// GO train, drive and hybrid, a "target monthly budget" input, coverage of
// London, "9,900+ live MLS listings", a "<2 min average analysis time", and
// results "based on your real income and debt — not estimates"; its example
// panel showed prices the engine would never produce; and its "Cities" and
// "Listings" links pointed at anchors that did not exist. This test keeps each
// of those from coming back, in the markup AND in all seven languages of HPT
// (src/i18n-homepage.js), because the markup is what a visitor sees first and
// HPT is what they see after touching the language menu.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).
// Run: node --no-warnings tests/homepage_claims_test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail !== undefined ? " :: " + detail : "")); }
}

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const calcHtml = fs.readFileSync(path.join(ROOT, "calculator.html"), "utf8");
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src", "i18n-homepage.js"), "utf8") + ";this.HPT=HPT;", ctx);
const HPT = ctx.HPT;
const LANGS = ["en", "fr", "zh", "pa", "hi", "ur", "es"];

// Visible text of the homepage markup (no scripts, styles or comments).
const visible = indexHtml.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
const allText = (l) => Object.values(HPT[l]).join(" \n ");

(async () => {
  // =============== 1. the removed claims stay removed ===============
  const BANNED = [
    [/GO Transit|GO train|GO ਟ੍ਰੇਨ|GO ट्रेन|GO ٹرین|GO火车|train GO|tren GO/i, "GO Transit / GO train (there is no transit data)"],
    [/London|伦敦|ਲੰਡਨ|लंदन|لندن/, "London (not a covered city)"],
    [/9,900|9 900/, "the hardcoded 9,900+ listings count"],
    [/<\s*2 min|&lt;2 min/, "the unmeasured <2 min analysis time"],
    [/5 minutes|5 minutos|5分钟|5 ਮਿੰਟ|5 मिनट|5 منٹ/, "the unmeasured 'in under 5 minutes'"],
    [/not estimates|pas des estimations|而非估算|ਅੰਦਾਜ਼ੇ ਨਹੀਂ|अनुमान नहीं|اندازے نہیں|no estimaciones/, "'not estimates' (they are estimates)"],
    [/monthly budget|budget mensuel|月度预算|ਮਹੀਨਾਵਾਰ ਬਜਟ|मासिक बजट|ماہانہ بجٹ|presupuesto mensual/i, "a monthly budget input (there is none)"],
    [/comfort zone|zone de confort|舒适预算区间|ਆਰਾਮਦਾਇਕ ਸੀਮਾ|आरामदायक सीमा|آرام دہ حد|zona de comodidad/i, "a 'monthly comfort zone' input (there is none)"],
    [/real GO|vrais horaires|真实的GO|horarios reales/i, "'real GO Transit schedules'"],
  ];
  for (const [re, what] of BANNED) {
    const inMarkup = re.test(visible);
    const inLangs = LANGS.filter((l) => re.test(allText(l)));
    check(`no ${what} — markup${inMarkup ? " (FOUND)" : ""}, languages${inLangs.length ? " (FOUND in " + inLangs.join(",") + ")" : ""}`, !inMarkup && inLangs.length === 0);
  }
  check("the calculator footer does not list London either", !/>London</.test(calcHtml));

  // Added 2026-09-23 with the market research: no superlatives TD, Wahi or
  // Zolo could contest, in any shipped string (displayed or not).
  const tctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src", "i18n.js"), "utf8") + ";this.T=T;", tctx);
  const SUPERLATIVE = /the only calculator|the first ontario|first tool|le seul calculateur|la única calculadora|唯一/i;
  const superlatives = [...LANGS.filter((l) => SUPERLATIVE.test(allText(l))).map((l) => "HPT." + l),
    ...LANGS.filter((l) => SUPERLATIVE.test(Object.values(tctx.T[l]).join(" "))).map((l) => "T." + l)];
  check("no 'only' / 'first' superlatives in any language", superlatives.length === 0 && !SUPERLATIVE.test(visible), superlatives.join(", "));
  // The terms page named CREA/REALTOR.ca as the listing source long after the
  // DDF feed was removed (2026-09-18); listings now come from PROPTX.
  const terms = fs.readFileSync(path.join(ROOT, "terms-of-use.html"), "utf8");
  check("the terms page no longer carries the CREA/REALTOR.ca DDF notice", !/REALTOR\.ca Canada Inc\. reproduces and distributes/.test(terms));
  check("...and carries the PROPTX notices, verbatim",
    terms.includes("Listing information is deemed reliable but is not guaranteed accurate by PROPTX.")
    && terms.includes("The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose."));

  // =============== 2. the markup and HPT.en agree ===============
  // The markup is what every visitor sees first; HPT.en is what they see after
  // switching back to English. They must say the same thing.
  const mismatched = Object.entries(HPT.en).filter(([id, text]) => {
    if (text.includes("<")) return false; // heroHeading carries a <span>; applied with innerHTML
    const m = new RegExp('id="' + id + '"[^>]*>([^<]*)<').exec(indexHtml);
    if (!m) return false; // keys without a plain-text element are applied by id only
    const markup = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    return markup !== text.trim();
  }).map(([id]) => id);
  check("every plain-text element's English matches HPT.en", mismatched.length === 0, mismatched.join(", "));
  check("HPT.en never shows a literal '&amp;' (textContent does not decode it)", !Object.values(HPT.en).some((v) => v.includes("&amp;")));
  const keys = Object.keys(HPT.en).sort().join();
  check("all seven languages have the same keys", LANGS.every((l) => Object.keys(HPT[l]).sort().join() === keys));

  // =============== 3. no dead in-page links ===============
  const ids = new Set([...indexHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const indexAnchors = [...indexHtml.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const deadIndex = [...new Set(indexAnchors.filter((a) => !ids.has(a)))];
  check("every #link on the homepage lands on something", deadIndex.length === 0, deadIndex.join(", "));
  const calcAnchors = [...calcHtml.matchAll(/href="\/#([^"]+)"/g)].map((m) => m[1]);
  const deadCalc = [...new Set(calcAnchors.filter((a) => !ids.has(a)))];
  check("every /#link on the calculator lands on something on the homepage", deadCalc.length === 0, deadCalc.join(", "));

  // =============== 4. the example is the engine's real output ===============
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1200));
  const win = dom.window;
  const rows = [...win.document.querySelectorAll("#heroExampleList .lb-row")].map((r) => ({
    city: r.querySelector(".lb-city").textContent,
    fit: r.querySelector(".lb-badge").textContent,
    meta: r.querySelector(".lb-meta").textContent,
  }));
  check("the example panel shows engine results (4 rows)", rows.length === 4, rows.length);
  const engine = win.eval(`homepageExampleRows(HOMEPAGE_EXAMPLE_BUYER, 4).map(function(e){ return {city:e.n, type:e.type, price:e.price, fit:e.fit.lbl, monthly:e.costs.total, pct:e.pct}; })`);
  check("each row is the engine's own city, home and label for the stated buyer",
    rows.length === engine.length && rows.every((r, i) => r.city === engine[i].city && r.fit === engine[i].fit
      && r.meta.startsWith(win.eval(`PROP_LABELS[${JSON.stringify(engine[i].type)}]`))), JSON.stringify(rows.slice(0, 2)));
  const PT = win.eval("PT");
  check("every example price is the price table's own figure, not a hand-typed one",
    engine.every((e) => PT[e.city] && PT[e.city][e.type] === e.price));
  check("every example row names its % of take-home and its drive", rows.every((r) => /% of take-home/.test(r.meta) && /min drive/.test(r.meta)));
  check("the example's commuter stays within the default 90-minute hybrid limit",
    rows.every((r) => { const m = /about (\d+) min drive/.exec(r.meta); return m && Number(m[1]) <= 90; }));
  check("computing the example leaves the page's own globals untouched",
    win.eval("grossMonthlyIncome === 0 && buyPower === 0 && workZone === null && workArrangement === 'remote' && firstTimeBuyer === false"));
  check("the example label says it is one sample buyer, and who", /SAMPLE BUYER/.test(win.document.getElementById("heroExampleLbl").textContent)
    && /\$150K household income/.test(win.document.getElementById("heroExampleBuyer").textContent));

  // Switching language keeps the stated buyer (translated) and the engine rows.
  win.eval("setLang('pa')");
  check("the buyer line is translated like the rest of the page", win.document.getElementById("heroExampleBuyer").textContent === HPT.pa.heroExampleBuyer);
  win.eval("setLang('en')");

  // #cities opens the coverage answer.
  win.location.hash = "#cities";
  await new Promise((r) => setTimeout(r, 50));
  check("following #cities opens the FAQ answer about coverage", win.document.getElementById("cities").classList.contains("open"));

  check("no script errors on the homepage", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
