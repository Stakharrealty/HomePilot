// Outcome tests: what a buyer actually sees on the results page.
// IMPROVEMENT_PLAN.md 1.6 (REVIEW_BACKLOG.md P2-8): "The tests check the code,
// not the outcomes. All 261 regression tests and 53 engine invariants pass
// while production shows P0-1 to P0-3."
//
// Every check here runs the REAL calculator page (calculator.html, every
// script it loads) in jsdom, fills the real form, runs go(), and then reads
// the rendered page the way a buyer would -- the cards, their text, their
// order -- rather than calling engine functions. The buyers are the review's
// own test couple and variations on it.
//
//   1. A commuter's results stay within their commute limit.
//   2. The #1 card never carries a warning.
//   3. The lead lists exactly the first cards on screen.
//   4. The comfort label and the comfort budget never contradict each other
//      on a card.
//   5. "N cities" counts only cities with a comfortable home; stretch-only
//      cities are listed separately.
//   6. The What-If scenario's #1 is the screen's #1 (one ranking).
//   7. Smaller fixes: the rate note's amortization, the lead form's visible
//      error, neutral icons, the sort switch, no Ottawa for a Toronto worker.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).
// Run: node --no-warnings tests/results_outcomes_test.js

const { JSDOM, VirtualConsole } = require("jsdom");

const URL_CALC = "http://localhost:8843/calculator.html";

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail !== undefined ? " :: " + detail : "")); }
}

async function openCalculator() {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(URL_CALC, { runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1000));
  // jsdom does no layout, so it has no scrollIntoView; the page calls it after
  // a search and after a lead is sent. A no-op keeps those calls from being
  // reported as script errors that a real browser would never raise.
  dom.window.Element.prototype.scrollIntoView = function () {};
  return { win: dom.window, errors };
}

// Fills the real form and runs the real calculation, as the Go button would
// once consent is given.
function search(win, b) {
  const d = win.document;
  d.getElementById("inc").value = String(b.income);
  d.getElementById("dwn").value = String(b.down);
  d.getElementById("dbt").value = String(b.debt || 0);
  d.getElementById("fam").value = String(b.family || 3);
  d.getElementById("area").value = "all";
  win.eval(`setFTB(${b.firstTime === true})`);
  win.eval(`setWorkArrangement(${JSON.stringify(b.work)})`);
  if (b.work !== "remote") {
    d.getElementById("workCity").value = b.workCity || "Toronto";
    d.getElementById("workPostal").value = "";
  }
  if (b.maxCommute !== undefined) win.eval(`setMaxCommute(${JSON.stringify(b.maxCommute)})`);
  win.eval("go()");
}

// A card as the buyer reads it.
function readCard(el) {
  const headline = el.querySelector(".card-headline");
  const m = headline ? /^(.*?) · \$([\d,]+)/.exec(headline.textContent.trim()) : null;
  const drive = el.querySelector(".commute-badge");
  const dm = drive ? /About (\d+) min drive/.exec(drive.textContent) : null;
  const monthly = el.querySelector("[id$='-mtotal']");
  return {
    city: el.querySelector(".cn").textContent.trim(),
    type: m ? m[1].trim() : null,
    price: m ? Number(m[2].replace(/,/g, "")) : null,
    monthly: monthly ? Number(monthly.textContent.replace(/[^0-9]/g, "")) : null,
    fit: el.querySelector(".fit-pill") ? el.querySelector(".fit-pill").textContent.trim() : null,
    drive: dm ? Number(dm[1]) : null,
    text: el.textContent,
  };
}
const mainCards = (win) => [...win.document.querySelectorAll("#list .city")].map(readCard);
const moreCards = (win) => [...win.document.querySelectorAll("#listMore .city")].map(readCard);
const WARNING = /⚠|long daily drive|stretches your comfort|beyond comfortable|Over your/;
const TYPE_LABEL = { condo: "Condo", town: "Townhouse", semi: "Semi-Detached", detached: "Detached" };

// The review's test buyer: first-time couple, $130K, $70K down, $450/month
// debt, family of 3, working in Toronto.
const COUPLE = { income: 130000, down: 70000, debt: 450, family: 3, firstTime: true, workCity: "Toronto" };

(async () => {
  const { win, errors } = await openCalculator();

  // =============== 1. commute limit ===============
  search(win, { ...COUPLE, work: "hybrid" });
  check("(1a) hybrid defaults to a 90-minute limit", win.eval("maxCommuteMin") === 90 && win.document.getElementById("maxCommute").value === "90");
  const hybridAll = [...mainCards(win), ...moreCards(win)];
  check("(1b) DONE WHEN: a hybrid Toronto worker sees only places within 90 minutes",
    hybridAll.length > 0 && hybridAll.every((c) => c.drive !== null && c.drive <= 90), hybridAll.map((c) => c.city + ":" + c.drive).join(", "));
  const notes = win.document.getElementById("rankNotes").textContent;
  check("(1c) the page says how many places were hidden for the commute, and offers them", /\d+ cities hidden — estimated drive over 90 min/.test(notes) && /Show them/.test(notes), notes);
  check("(1d) Welland (was #1) and Ottawa (was #13) are not on the page", !hybridAll.some((c) => c.city === "Welland" || c.city === "Ottawa"));
  win.eval("toggleOverCommute()");
  const shown = moreCards(win);
  check("(1e) 'Show them' lists the far places in their own section, never among the ranked ones",
    shown.some((c) => c.drive > 90) && mainCards(win).every((c) => c.drive <= 90) && /Past your 90-minute commute limit/.test(win.document.getElementById("listMore").textContent));
  win.eval("toggleOverCommute()");

  search(win, { ...COUPLE, income: 200000, down: 150000, work: "daily" });
  check("(1f) daily defaults to a 60-minute limit", win.eval("maxCommuteMin") === 60);
  const daily = mainCards(win);
  check("(1g) a daily commuter's ranked places are all within 60 minutes", daily.length > 0 && daily.every((c) => c.drive <= 60), daily.map((c) => c.city + ":" + c.drive).join(", "));
  win.eval("setMaxCommute('45')");
  const tighter = mainCards(win);
  check("(1h) tightening the limit to 45 re-applies it on the spot", tighter.every((c) => c.drive <= 45) && tighter.length <= daily.length);
  win.eval("setMaxCommute('none')");
  check("(1i) 'No limit' hides nothing", !/hidden — estimated drive/.test(win.document.getElementById("rankNotes").textContent));

  // =============== 2. the #1 card never carries a warning ===============
  const profiles = [
    { ...COUPLE, work: "hybrid" }, { ...COUPLE, work: "hybrid", maxCommute: "none" },
    { ...COUPLE, income: 200000, down: 150000, work: "daily" }, { ...COUPLE, work: "remote" },
    { income: 90000, down: 40000, debt: 300, family: 2, work: "remote" }, { income: 300000, down: 300000, family: 4, work: "hybrid" },
  ];
  for (const p of profiles) {
    search(win, p);
    const cards = mainCards(win);
    const first = cards[0];
    const tag = `$${p.income / 1000}K ${p.work}${p.maxCommute ? " limit " + p.maxCommute : ""}`;
    check(`(2a) the #1 card carries no warning (${tag})`, !first || (!WARNING.test(first.text) && first.fit !== "Stretch"), first && first.text.slice(0, 160));
    check(`(2b) no card in the ranked list is a Stretch (${tag})`, cards.every((c) => c.fit !== "Stretch"), cards.filter((c) => c.fit === "Stretch").map((c) => c.city).join(","));
    // 4. The comfort label and the comfort budget agree on every ranked card.
    const comfort = win.eval("comfortBuyPower");
    check(`(4) every ranked card is inside the comfort range AND not labelled Stretch (${tag})`, cards.every((c) => c.price <= comfort && c.fit !== "Stretch"), comfort);
    // 5. The count is the ranked cards; stretch-only cities are separate.
    const cnt = win.document.getElementById("cnt").textContent;
    const n = (/(\d+)\s+(?:city|cities)/.exec(cnt) || [])[1];
    check(`(5a) "N cities" equals the ranked cards on screen (${tag})`, cards.length === 0 ? /No cities/.test(cnt) : Number(n) === cards.length, `${cnt} vs ${cards.length}`);
    const stretchCards = [...win.document.querySelectorAll("#listMore .more-section")].filter((s) => /Only as a stretch/.test(s.textContent));
    check(`(5b) stretch-only cities sit in their own section, below (${tag})`, stretchCards.every((s) => [...s.querySelectorAll(".city")].every((el) => /beyond comfortable/.test(el.textContent))));
  }

  // =============== 3. the lead is what the buyer saw ===============
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid" });
  const onScreen = [...mainCards(win), ...moreCards(win)].slice(0, 5);
  let sentBody = null;
  win.fetch = async (u, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };
  win.document.getElementById("nm").value = "Test Buyer";
  win.document.getElementById("em").value = "test@example.com";
  await win.eval("sub()");
  check("(3a) a lead was sent", !!sentBody);
  const tm = (sentBody && sentBody.topMatches) || [];
  check("(3b) DONE WHEN: the lead's top matches are the first cards on screen, same order",
    onScreen.length > 0 && tm.map((m) => m.city).join("|") === onScreen.map((c) => c.city).join("|"),
    tm.map((m) => m.city).join("|") + "  vs  " + onScreen.map((c) => c.city).join("|"));
  check("(3c) ...with the card's own home type, price and monthly cost",
    tm.length === onScreen.length && tm.every((m, i) => TYPE_LABEL[m.type] === onScreen[i].type && m.price === onScreen[i].price && Math.round(m.monthlyCost) === onScreen[i].monthly),
    JSON.stringify(tm.slice(0, 2)) + " vs " + JSON.stringify(onScreen.slice(0, 2).map(({ text, ...c }) => c)));
  win.eval("setResultsSort('cost')");
  const reordered = [...mainCards(win), ...moreCards(win)].slice(0, 5);
  sentBody = null;
  win.document.getElementById("done").style.display = "none";
  win.document.getElementById("subBtn").disabled = false;
  await win.eval("sub()");
  check("(3d) re-sorting changes the lead the same way it changes the screen",
    sentBody && sentBody.topMatches.map((m) => m.city).join("|") === reordered.map((c) => c.city).join("|"));

  // =============== 6. one ranking for the screen and the scenarios ===============
  win.eval("setResultsSort('home')");
  const screenFirst = mainCards(win)[0];
  win.eval("openScenarioSandbox()");
  const snap = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  check("(6) the What-If scenario's #1 place is the #1 card on screen",
    !!screenFirst && snap.picks && snap.picks.home.n === screenFirst.city, `${snap.picks && snap.picks.home.n} vs ${screenFirst && screenFirst.city}`);
  win.eval("closeScenarioSandbox()");

  // =============== 7. smaller fixes ===============
  search(win, { ...COUPLE, work: "remote", firstTime: true });
  const rate = win.document.getElementById("rateNote").textContent;
  check("(7a) a first-time buyer's rate note names 30-year amortization (P1-10)", /30-year amortization \(first-time buyer\)/.test(rate) && !/^.*25-year amortization \(30-year available/.test(rate), rate);
  search(win, { ...COUPLE, work: "remote", firstTime: false });
  check("(7b) a repeat buyer's rate note says when 30 years applies", /25-year amortization, or 30-year on homes where your down payment is 20% or more/.test(win.document.getElementById("rateNote").textContent));

  const errEl = win.document.getElementById("leadFieldErr");
  win.document.getElementById("nm").value = "";
  win.document.getElementById("em").value = "";
  win.eval("showTransparencyModal()");
  check("(7c) an empty lead form shows a visible error, not nothing (P1-12)", errEl.style.display === "block" && /name and email/.test(errEl.textContent));
  check("(7d) ...marks the fields, and does not open the consent modal",
    win.document.getElementById("nm").getAttribute("aria-invalid") === "true" && win.document.getElementById("transparencyModalOverlay").style.display !== "flex");
  win.document.getElementById("nm").value = "A";
  win.document.getElementById("em").value = "not-an-email";
  win.eval("showTransparencyModal()");
  check("(7e) a malformed email is caught too", /doesn't look complete/.test(errEl.textContent));
  check("(7f) name and email are marked required in the markup", win.document.getElementById("nm").required && win.document.getElementById("em").required);

  search(win, { ...COUPLE, income: 250000, down: 200000, work: "hybrid" });
  const glance = [...win.document.querySelectorAll("#list .city")].flatMap((el) => [...el.querySelectorAll("div")].filter((d) => /At a glance/.test(d.textContent) && d.children.length > 1));
  const ticks = win.document.querySelector("#list").innerHTML;
  check("(7g) no green tick sits next to a stretch or a commute fact (P1-6)",
    !/✓<\/span><span>[^<]*(stretch|Estimated commute)/.test(ticks) && glance.length > 0);
  win.eval("setResultsSort('cost')");
  const byCost = mainCards(win);
  check("(7h) 'Lowest monthly cost' puts the cheapest card first", byCost.every((c, i) => i === 0 || byCost[i - 1].monthly <= c.monthly), byCost.map((c) => c.monthly).join(","));
  win.eval("setResultsSort('commute')");
  const byDrive = mainCards(win);
  check("(7i) 'Shortest commute' puts the shortest estimated drive first", byDrive.every((c, i) => i === 0 || byDrive[i - 1].drive <= c.drive), byDrive.map((c) => c.drive).join(","));
  check("(7j) the rule in force is stated in one sentence", /Ranked by shortest estimated drive to work/.test(win.document.getElementById("rankNotes").textContent));
  search(win, { ...COUPLE, work: "remote" });
  check("(7k) remote: no 'Shortest commute' sort, no commute limit", win.document.getElementById("sort-commute").style.display === "none" && win.eval("maxCommuteMin") === null);
  check("(7l) the property list uses the one fit function: no '<35 / <=45' leftovers in the page code",
    !/pct<35\)\{fitLbl='Great Fit'/.test(win.eval("render.toString()+selectPropType.toString()")));

  check("(8) no uncaught script errors during any of this", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
