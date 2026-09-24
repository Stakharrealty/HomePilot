// Homepage claims: nothing the product doesn't back up.
// IMPROVEMENT_PLAN.md 1.3 (REVIEW_BACKLOG.md P0-4).
//
// The homepage claimed "real GO Transit schedules", a commute toggle between
// GO train, drive and hybrid, a "target monthly budget" input, coverage of
// London, "9,900+ live MLS listings", a "<2 min average analysis time", and
// results "based on your real income and debt — not estimates"; its example
// panel showed prices the engine would never produce; and its "Cities" and
// "Listings" links pointed at anchors that did not exist. This test keeps each
// of those from coming back.
//
// Until 2026-09-23 it also checked the six translations of the homepage
// (src/i18n-homepage.js). The site is English only now (IMPROVEMENT_PLAN.md
// 2.4b), so the markup is the only copy a visitor can see;
// tests/english_only_test.js keeps the translations and the menu gone.
//
// Since 2026-09-24 (IMPROVEMENT_PLAN.md 2.4c) the example's sample buyer is a
// couple on two incomes, $90K + $60K. Section 3 checks the line above the
// panel against the buyer, that take-home is taxed person by person, and that
// the rows are exactly what the calculator page shows the same couple.
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

// Visible text of the homepage markup (no scripts, styles or comments).
const visible = indexHtml.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");

(async () => {
  // =============== 1. the removed claims stay removed ===============
  const BANNED = [
    [/GO Transit|GO train/i, "GO Transit / GO train (there is no transit data)"],
    [/London/, "London (not a covered city)"],
    [/9,900/, "the hardcoded 9,900+ listings count"],
    [/<\s*2 min|&lt;2 min/, "the unmeasured <2 min analysis time"],
    [/5 minutes/, "the unmeasured 'in under 5 minutes'"],
    [/not estimates/, "'not estimates' (they are estimates)"],
    [/monthly budget/i, "a monthly budget input (there is none)"],
    [/comfort zone/i, "a 'monthly comfort zone' input (there is none)"],
    [/real GO/i, "'real GO Transit schedules'"],
  ];
  for (const [re, what] of BANNED) {
    check(`no ${what} on the homepage`, !re.test(visible));
  }
  check("the calculator footer does not list London either", !/>London</.test(calcHtml));

  // Added 2026-09-23 with the market research: no superlatives TD, Wahi or
  // Zolo could contest, in any shipped string (displayed or not).
  const tctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src", "i18n.js"), "utf8") + ";this.T=T;", tctx);
  const SUPERLATIVE = /the only calculator|the first ontario|first tool/i;
  check("no 'only' / 'first' superlatives on the homepage or in the scripts' English strings",
    !SUPERLATIVE.test(Object.values(tctx.T.en).join(" ")) && !SUPERLATIVE.test(visible));
  // The terms page named CREA/REALTOR.ca as the listing source long after the
  // DDF feed was removed (2026-09-18); listings now come from PROPTX.
  const terms = fs.readFileSync(path.join(ROOT, "terms-of-use.html"), "utf8");
  check("the terms page no longer carries the CREA/REALTOR.ca DDF notice", !/REALTOR\.ca Canada Inc\. reproduces and distributes/.test(terms));
  check("...and carries the PROPTX notices, verbatim",
    terms.includes("Listing information is deemed reliable but is not guaranteed accurate by PROPTX.")
    && terms.includes("The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose."));

  // =============== 2. no dead in-page links ===============
  const ids = new Set([...indexHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const indexAnchors = [...indexHtml.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const deadIndex = [...new Set(indexAnchors.filter((a) => !ids.has(a)))];
  check("every #link on the homepage lands on something", deadIndex.length === 0, deadIndex.join(", "));
  const calcAnchors = [...calcHtml.matchAll(/href="\/#([^"]+)"/g)].map((m) => m[1]);
  const deadCalc = [...new Set(calcAnchors.filter((a) => !ids.has(a)))];
  check("every /#link on the calculator lands on something on the homepage", deadCalc.length === 0, deadCalc.join(", "));

  // =============== 3. the example is the engine's real output ===============
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
  check("the example's commuter stays within the default 60-minute hybrid limit",
    rows.every((r) => { const m = /about (\d+) min drive/.exec(r.meta); return m && Number(m[1]) <= 60; }));
  // Work arrangement and first-time buyer start unanswered (null) since
  // 2026-09-24 (IMPROVEMENT_PLAN.md 2.5); they were 'remote' and false.
  check("computing the example leaves the page's own globals untouched",
    win.eval("grossMonthlyIncome === 0 && buyPower === 0 && workZone === null && workArrangement === null && firstTimeBuyer === null"));
  check("the example label says it is one sample buyer, and who", /SAMPLE BUYER/.test(win.document.getElementById("heroExampleLbl").textContent)
    && /\$150K household income \(\$90K \+ \$60K\) · \$100K down · first-time buyers · work in Toronto 2–4 days a week/.test(win.document.getElementById("heroExampleBuyer").textContent),
    win.document.getElementById("heroExampleBuyer").textContent);

  // =============== 3b. two incomes (IMPROVEMENT_PLAN.md 2.4c) ===============
  // The sample buyer is a couple, $90K + $60K. Take-home is taxed person by
  // person, as the calculator does (plan 3.3), so every "% of take-home" and
  // fit label is worked out on the two-earner figure.
  const buyer = win.eval("HOMEPAGE_EXAMPLE_BUYER");
  check("the sample buyer is two earners, $90,000 + $60,000", buyer.income === 90000 && buyer.partnerIncome === 60000, JSON.stringify(buyer));
  const said = /\$(\d+)K household income \(\$(\d+)K \+ \$(\d+)K\) · \$(\d+)K down/.exec(win.document.getElementById("heroExampleBuyer").textContent);
  check("the line above the example states the buyer's own figures: total, both incomes, down payment",
    !!said && Number(said[1]) * 1000 === buyer.income + buyer.partnerIncome && Number(said[2]) * 1000 === buyer.income
      && Number(said[3]) * 1000 === buyer.partnerIncome && Number(said[4]) * 1000 === buyer.down, said && said[0]);
  const pairNet = win.eval("estimateHouseholdNetAnnual(90000, 60000) / 12");
  const soloNet = win.eval("estimateOntarioNetAnnual(150000) / 12");
  const pctOf = (e, net) => Math.round(e.monthly / net * 100);
  check("each row's % of take-home is on the two-earner take-home (each income taxed separately)",
    engine.length > 0 && engine.every((e, i) => e.pct === pctOf(e, pairNet) && rows[i].meta.includes(" · " + e.pct + "% of take-home")),
    engine.map((e) => e.city + " " + e.pct + "% vs " + pctOf(e, pairNet) + "%").join("; "));
  check("...and not on one earner's take-home on $150K (that would read higher)",
    engine.some((e) => pctOf(e, soloNet) > e.pct), engine.map((e) => e.city + " " + e.pct + "% vs one earner " + pctOf(e, soloNet) + "%").join("; "));

  // The same couple on the calculator page: fill its real form (both income
  // boxes) and run go(). The homepage must show its first four cards exactly.
  const calcErrors = [];
  const calcConsole = new VirtualConsole();
  calcConsole.on("jsdomError", (e) => calcErrors.push(e.message));
  const cdom = await JSDOM.fromURL("http://localhost:8843/calculator.html", { runScripts: "dangerously", resources: "usable", virtualConsole: calcConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1000));
  const cwin = cdom.window, cd = cwin.document;
  cwin.Element.prototype.scrollIntoView = function () {}; // jsdom has no layout; go() calls it
  cd.getElementById("inc").value = String(buyer.income);
  cd.getElementById("inc2").value = String(buyer.partnerIncome);
  cd.getElementById("dwn").value = String(buyer.down);
  cd.getElementById("dbt").value = String(buyer.debt);
  cd.getElementById("fam").value = String(buyer.family);
  cd.getElementById("area").value = "all";
  cwin.eval(`setFTB(${buyer.firstTimeBuyer === true})`);
  cwin.eval("setResident(true)");
  cwin.eval(`setWorkArrangement(${JSON.stringify(buyer.work)})`);
  cd.getElementById("workCity").value = "Toronto";
  cd.getElementById("workPostal").value = "";
  cwin.eval("go()");
  check("the calculator places a Toronto worker where the example does, with the same default limit",
    cwin.eval("workZone") === buyer.workZone && cwin.eval("maxCommuteMin") === 60 && cwin.eval("resultsSort") === "home");
  check("the calculator's take-home for this couple is the example's two-earner figure",
    Math.abs(cwin.eval("netMonthlyIncome") - pairNet) < 0.01, cwin.eval("netMonthlyIncome") + " vs " + pairNet);
  const calcCards = [...cd.querySelectorAll("#list .city")].slice(0, 4).map((el) => {
    const head = /^(.*?) · \$([\d,]+)/.exec(el.querySelector(".card-headline").textContent.trim());
    const pct = /(\d+)% of take-home/.exec(el.textContent);
    const drive = /About (\d+) min drive/.exec((el.querySelector(".commute-badge") || {}).textContent || "");
    return {
      city: el.querySelector(".cn").textContent.trim(),
      type: head ? head[1].trim() : null,
      price: head ? Number(head[2].replace(/,/g, "")) : null,
      monthly: Number(el.querySelector("[id$='-mtotal']").textContent.replace(/[^0-9]/g, "")),
      fit: el.querySelector(".fit-pill").textContent.trim(),
      pct: pct ? Number(pct[1]) : null,
      drive: drive ? Number(drive[1]) : null,
    };
  });
  const K = (n) => "$" + Math.round(n / 1000) + "K";
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  check("the example's 4 rows are the calculator's first 4 cards for the same couple: place, home, price, monthly cost, label, % and drive",
    calcCards.length === 4 && rows.length === 4 && calcCards.every((c, i) => {
      const r = rows[i], e = engine[i];
      return r.city === c.city && r.fit === c.fit && e.price === c.price
        && r.meta === c.type + " · " + K(c.price) + " · " + money(c.monthly) + "/mo · " + c.pct + "% of take-home · about " + c.drive + " min drive";
    }),
    JSON.stringify({ homepage: rows.map((r) => r.city + ": " + r.meta), calculator: calcCards }));
  check("no script errors on the calculator page", calcErrors.length === 0, calcErrors.join(" | "));
  cwin.close();

  // #cities opens the coverage answer.
  win.location.hash = "#cities";
  await new Promise((r) => setTimeout(r, 50));
  check("following #cities opens the FAQ answer about coverage", win.document.getElementById("cities").classList.contains("open"));

  check("no script errors on the homepage", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
