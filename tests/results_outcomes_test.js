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
//   3. The old lead form is gone (removed 2026-09-23 to be rebuilt later);
//      WhatsApp and the consent gate stay. The PDF report and Compare show
//      exactly the cards on screen (shownCards), before and after a re-sort.
//   4. The comfort label and the comfort budget never contradict each other
//      on a card.
//   5. "N cities" counts only cities with a comfortable home; stretch-only
//      cities are listed separately.
//   6. The What-If scenario's #1 is the screen's #1 (one ranking).
//   7. Smaller fixes: the rate note's amortization, neutral icons, the sort
//      switch, no Ottawa for a Toronto worker.
//  12. No pre-filled answers: "Work arrangement" and "First-time buyer" start
//      unanswered, and no results appear until both are chosen.
//  13. The shorter form (IMPROVEMENT_PLAN.md 2.3a): the income and debt
//      wording, the commute limit, preferred area and work postal code as one
//      line each, the "never owned a home" box in the cash-to-close breakdown,
//      and citizenship as one small box. Every setting still works.
//  14. The top section (IMPROVEMENT_PLAN.md 2.2): one number, the HomePilot
//      comfort range; one small line for the bank, or for savings when they
//      are the limit; "Based on ..." with both incomes; one line of small
//      print with the details behind it; and the estimated take-home, which
//      the buyer can replace with their own: that changes every % of
//      take-home and every fit label, and never the buying power.
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
  // a search. A no-op keeps those calls from being reported as script errors
  // that a real browser would never raise.
  dom.window.Element.prototype.scrollIntoView = function () {};
  return { win: dom.window, errors };
}

// Fills the real form and runs the real calculation, as the Go button would
// once consent is given.
function search(win, b) {
  const d = win.document;
  d.getElementById("inc").value = String(b.income);
  d.getElementById("inc2").value = b.partnerIncome ? String(b.partnerIncome) : ""; // 2026-09-23: two incomes
  d.getElementById("dwn").value = String(b.down);
  d.getElementById("dbt").value = String(b.debt || 0);
  d.getElementById("fam").value = String(b.family || 3);
  d.getElementById("area").value = "all";
  win.eval(`setFTB(${b.firstTime === true})`);
  // 2026-09-23 (IMPROVEMENT_PLAN.md 1.7): the rebate box and residency.
  // Since 2026-09-24 (2.3a D) the rebate box is in the cash-to-close
  // breakdown on the results, so the answer is set the way that box sets it;
  // section 13 ticks the box itself. Citizenship is the form's one box (2.3a E).
  win.eval(`setLttRebateConfirmed(${b.neverOwnedAnywhere === true})`);
  const nonRes = d.getElementById("nonResident");
  nonRes.checked = b.resident === false;
  nonRes.dispatchEvent(new win.Event("change"));
  win.eval(`setWorkArrangement(${JSON.stringify(b.work)})`);
  if (b.work !== "remote") {
    d.getElementById("workCity").value = b.workCity || "Toronto";
    d.getElementById("workPostal").value = b.workPostal || "";
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
  // 2026-09-24 (IMPROVEMENT_PLAN.md 2.2a): the default is 60 minutes for hybrid
  // as well as daily (hybrid was 90).
  search(win, { ...COUPLE, work: "hybrid" });
  check("(1a) hybrid defaults to a 60-minute limit", win.eval("maxCommuteMin") === 60 && win.document.getElementById("maxCommute").value === "60");
  const hybridAll = [...mainCards(win), ...moreCards(win)];
  check("(1b) DONE WHEN: a hybrid Toronto worker sees only places within 60 minutes",
    hybridAll.length > 0 && hybridAll.every((c) => c.drive !== null && c.drive <= 60), hybridAll.map((c) => c.city + ":" + c.drive).join(", "));
  const notes = win.document.getElementById("rankNotes").textContent;
  check("(1c) the page says how many places were hidden for the commute, and offers them", /\d+ cities hidden — estimated drive over 60 min/.test(notes) && /Show them/.test(notes), notes);
  check("(1d) Welland (was #1) and Ottawa (was #13) are not on the page", !hybridAll.some((c) => c.city === "Welland" || c.city === "Ottawa"));
  win.eval("toggleOverCommute()");
  const shown = moreCards(win);
  check("(1e) 'Show them' lists the far places in their own section, never among the ranked ones",
    shown.some((c) => c.drive > 60) && mainCards(win).every((c) => c.drive <= 60) && /Past your 60-minute commute limit/.test(win.document.getElementById("listMore").textContent));
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
  // 2.2a: 75, 90 and "No limit" stay in the list for buyers who pick them.
  const choices = [...win.document.querySelectorAll("#maxCommute option")].map((o) => o.value);
  win.eval("setMaxCommute('90')");
  const longer = mainCards(win);
  check("(1j) 75, 90 and 'No limit' can still be picked; 90 brings back places up to 90 minutes away",
    ["75", "90", "none"].every((v) => choices.includes(v)) && win.eval("maxCommuteMin") === 90
      && longer.length >= daily.length && longer.every((c) => c.drive <= 90)
      && /estimated drive over 90 min/.test(win.document.getElementById("rankNotes").textContent),
    choices.join(",") + " :: " + longer.map((c) => c.city + ":" + c.drive).join(", "));
  win.eval("setMaxCommute('none')");

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

  // =============== 3. the old lead form is gone ===============
  // Removed 2026-09-23 by the user's decision, to be rebuilt properly later.
  // Until then nothing on the page collects a lead, and WhatsApp is the way
  // to reach Sandeep.
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid" });
  const d3 = win.document;
  check("(3a) no lead form on the results page: no name, email or 'Send me homes' button",
    !d3.getElementById("cap") && !d3.getElementById("nm") && !d3.getElementById("em") && !d3.getElementById("subBtn") && !/Send me homes in my budget/.test(d3.body.textContent));
  check("(3b) ...no 'In the spirit of transparency' pop-up, and no leftover functions",
    !d3.getElementById("transparencyModalOverlay") && typeof win.sub === "undefined" && typeof win.showTransparencyModal === "undefined" && typeof win.confirmSendLead === "undefined");
  check("(3c) the WhatsApp link to Sandeep is still there", !!d3.querySelector('a[href*="wa.me"]'));
  check("(3d) the 'Before we show your numbers' consent gate is untouched", !!d3.getElementById("consentModalOverlay"));

  // The record the PDF report and Compare are built from (shownCards, kept by
  // render()). The lead was checked against the screen this way until it was
  // removed; these two still read the record, so it must follow the screen
  // (REVIEW_BACKLOG.md P0-3: the report once listed different cities).
  const cardsOnScreen = () => [...mainCards(win), ...moreCards(win)];
  const cityOrder = (list) => list.map((c) => c.city).join("|");
  const matchesScreen = (rec, screen) => rec.length === screen.length && rec.every((m, i) =>
    m.city === screen[i].city && TYPE_LABEL[m.type] === screen[i].type && m.price === screen[i].price && Math.round(m.monthlyCost) === screen[i].monthly);
  const cardDetail = (rec, screen) => JSON.stringify(rec.slice(0, 2)) + " vs " + JSON.stringify(screen.slice(0, 2).map(({ text, ...c }) => c));
  // downloadReport() and buildCompare() write into a new window; jsdom has
  // none, so capture what they write.
  const written = [];
  const realOpen = win.open, realAlert = win.alert;
  win.open = () => { const w = { html: "", document: { write(h) { w.html += h; }, close() {} }, focus() {}, print() {}, close() {} }; written.push(w); return w; };
  win.alert = (msg) => written.push({ html: "", alert: String(msg) });
  const reportCities = () => { written.length = 0; win.eval("downloadReport()"); const w = written[0] || { html: "" }; return { cities: [...w.html.matchAll(/class="pr-city-name">([^<]*)</g)].map((x) => x[1]), alert: w.alert }; };

  const onScreen = cardsOnScreen();
  const rec = win.eval("shownCards").map((c) => ({ ...c }));
  check("(3e) shownCards is the cards on screen, same order",
    onScreen.length > 0 && cityOrder(rec) === cityOrder(onScreen), cityOrder(rec) + "  vs  " + cityOrder(onScreen));
  check("(3f) ...with each card's own home type, price and monthly cost", matchesScreen(rec, onScreen), cardDetail(rec, onScreen));
  const report = reportCities();
  check("(3g) the PDF report lists the first five cards on screen, same order",
    !report.alert && report.cities.join("|") === cityOrder(onScreen.slice(0, 5)), (report.alert || report.cities.join("|")) + "  vs  " + cityOrder(onScreen.slice(0, 5)));

  win.eval("setResultsSort('cost')");
  const reordered = cardsOnScreen();
  const rec2 = win.eval("shownCards").map((c) => ({ ...c }));
  check("(3h) re-sorting changes shownCards the same way it changes the screen",
    matchesScreen(rec2, reordered), cityOrder(rec2).slice(0, 120) + "  vs  " + cityOrder(reordered).slice(0, 120));
  const report2 = reportCities();
  check("(3i) ...and the PDF report follows the new order",
    !report2.alert && report2.cities.join("|") === cityOrder(reordered.slice(0, 5)), (report2.alert || report2.cities.join("|")) + "  vs  " + cityOrder(reordered.slice(0, 5)));

  const ticked = reordered.slice(0, 2);
  written.length = 0;
  win.eval(`cmpSelected=${JSON.stringify(ticked.map((c) => c.city))}; buildCompare();`);
  const cmpDoc = written[0] && written[0].html ? new win.DOMParser().parseFromString(written[0].html, "text/html") : null;
  const cmpHeads = cmpDoc ? [...cmpDoc.querySelectorAll(".cmp-head-cell")].slice(1).map((e) => e.textContent.trim()) : [];
  const cmpRow = (i) => { const row = cmpDoc ? cmpDoc.querySelectorAll(".cmp-row")[i] : null; return row ? [...row.querySelectorAll(".cmp-cell")].slice(1).map((e) => Number(e.textContent.replace(/[^0-9]/g, ""))) : []; };
  check("(3j) Compare shows the home each ticked card showed: same places, price and monthly cost",
    cmpHeads.join("|") === cityOrder(ticked) && cmpRow(0).join("|") === ticked.map((c) => c.price).join("|") && cmpRow(1).join("|") === ticked.map((c) => c.monthly).join("|"),
    JSON.stringify({ cmpHeads, prices: cmpRow(0), monthly: cmpRow(1) }) + " vs " + JSON.stringify(ticked.map(({ city, price, monthly }) => ({ city, price, monthly }))));
  win.eval("cmpSelected=[]");
  win.open = realOpen; win.alert = realAlert;

  // Stands in for the network, so the share test (11h) can read what would be saved.
  let sentBody = null;
  win.fetch = async (u, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };

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

  // (7c-7f checked the lead form's required fields; the form was removed 2026-09-23.)

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
    !/pct<35\)\{fitLbl='Great Fit'/.test(win.eval("render.toString()+selectPropType.toString()+costPanelHtml.toString()")));

  // =============== 9. newcomers: the rebate and non-resident taxes (1.7) ===============
  // Opens one Toronto city's cost breakdown the way a buyer taps it.
  const breakdown = (city, type) => {
    const id = "c-" + city.replace(/[^a-zA-Z0-9]/g, "-");
    win.eval(`selectPropType(${JSON.stringify(id)}, ${JSON.stringify(type)}, ${JSON.stringify(city)})`);
    const panel = win.document.getElementById("pt-panel-" + id + "-" + type);
    return panel ? panel.textContent : "";
  };
  const cash = (text) => Number((/Estimated Cash Required to Close~\$([\d,]+)/.exec(text) || [])[1].replace(/,/g, ""));
  const TOR = { income: 200000, down: 150000, debt: 0, family: 3, work: "remote" };
  const torId = "c-Toronto---Scarborough";
  const torPanel = (type) => win.document.getElementById("pt-panel-" + torId + "-" + type);
  search(win, { ...TOR, firstTime: true, neverOwnedAnywhere: false });
  const torType = win.eval("PT['Toronto - Scarborough'].condo") ? "condo" : "town";
  const newcomer = breakdown("Toronto - Scarborough", torType);
  // 2.3a D: the box is in the cash-to-close breakdown now, not on the form.
  const rebateBoxes = torPanel(torType).querySelectorAll(".ltt-rebate-box");
  check("(9a) a first-time buyer's cash-to-close breakdown offers the rebate box, unticked",
    rebateBoxes.length === 1 && !rebateBoxes[0].checked && /ever owned a home, anywhere in the world/.test(newcomer), newcomer.slice(-500));
  check("(9b) first-time buyer who hasn't confirmed never owning a home anywhere: no rebate in cash to close, and the panel says why",
    !/First-Time Buyer Rebate/.test(newcomer) && /rebate not included/.test(newcomer), newcomer.slice(-400));
  search(win, { ...TOR, firstTime: true, neverOwnedAnywhere: true });
  const eligible = breakdown("Toronto - Scarborough", torType);
  const rebate = Number((/First-Time Buyer Rebate-\$([\d,]+)/.exec(eligible) || [0, "0"])[1].replace(/,/g, ""));
  check("(9c) confirmed and resident: Ontario + Toronto rebates, up to $8,475, come off cash to close",
    rebate > 4000 && rebate <= 8475 && cash(newcomer) - cash(eligible) === rebate, `${rebate} / ${cash(newcomer)} vs ${cash(eligible)}`);
  search(win, { ...TOR, firstTime: true, neverOwnedAnywhere: true, resident: false });
  const nonRes = breakdown("Toronto - Scarborough", torType);
  const price = win.eval(`PT['Toronto - Scarborough'][${JSON.stringify(torType)}]`);
  check("(9d) non-resident: Ontario's 25% and Toronto's 10% are in cash to close, and no rebate",
    nonRes.includes("Ontario Non-Resident Speculation Tax (25%)$" + Math.round(price * 0.25).toLocaleString("en-CA"))
      && nonRes.includes("Toronto Non-Resident Speculation Tax (10%)$" + Math.round(price * 0.10).toLocaleString("en-CA"))
      && !/First-Time Buyer Rebate/.test(nonRes), nonRes.slice(0, 600));
  check("(9e) ...and the results say most non-Canadians can't buy yet", /January 1, 2027/.test(win.document.getElementById("bpSub").textContent));
  win.eval("saveBuyerProfile()");
  const saved = JSON.parse(win.sessionStorage.getItem("hp_buyer_profile_v1"));
  check("(9f) the listing pages get the same answers (no rebate, non-resident)", saved.lttRebateEligible === false && saved.canadianResident === false);
  check("(9f2) a non-resident is not offered the rebate box, which could not change anything", nonRes.length > 0 && torPanel(torType).querySelectorAll(".ltt-rebate-box").length === 0);
  search(win, { ...TOR, firstTime: false });
  const repeat = breakdown("Toronto - Scarborough", torType);
  check("(9g) not a first-time buyer: no rebate box in the breakdown, and no rebate",
    /Estimated Cash Required to Close/.test(repeat) && torPanel(torType).querySelectorAll(".ltt-rebate-box").length === 0
      && !/First-Time Buyer Rebate|ever owned a home/.test(repeat) && win.eval("lttRebateConfirmed") === false, repeat.slice(-300));

  // =============== 10. "Lowest monthly cost" means the cheapest home ===============
  // Reported on the live site 2026-09-23: $234,243 income, $324,234 down,
  // daily to L4W (Mississauga), 30-minute limit. Sorted by "Lowest monthly
  // cost", #1 was a West End condo at $2,916/mo while #3, Brampton, listed a
  // condo at $2,426/mo: the sort compared each place's biggest comfortable
  // home, not its cheapest. (7h) passed anyway, because it only checked that
  // the headlines went up. These read every row on every card, as a buyer does.
  const REPORTED = { income: 234243, down: 324234, debt: 0, family: 3, firstTime: false, work: "daily", workCity: "Mississauga", workPostal: "L4W 5L5", maxCommute: 30 };
  const RANK = { Condo: 1, Townhouse: 2, "Semi-Detached": 3, Detached: 4 };
  const rowsOf = (el) => [...el.querySelectorAll("[id^='pt-row-']:not([id$='-chevron'])")].map((r) => {
    const m = /\$([\d,]+) · \$([\d,]+)\/mo/.exec(r.textContent);
    return {
      type: r.firstElementChild && r.firstElementChild.firstElementChild ? r.firstElementChild.firstElementChild.textContent.trim() : null,
      price: m ? Number(m[1].replace(/,/g, "")) : null,
      monthly: m ? Number(m[2].replace(/,/g, "")) : null,
      stretch: /Stretch/.test(r.textContent),
    };
  });
  const cardsWithRows = () => [...win.document.querySelectorAll("#list .city")].map((el) => ({ ...readCard(el), rows: rowsOf(el) }));
  search(win, REPORTED);
  const comfortCap = win.eval("comfortBuyPower");
  const comfortableRows = (c) => c.rows.filter((r) => !r.stretch && r.price !== null && r.price <= comfortCap);
  win.eval("setResultsSort('cost')");
  const costCards = cardsWithRows();
  check("(10a) the reported buyer gets several places to compare", costCards.length >= 2 && costCards.every((c) => c.rows.length > 0), String(costCards.length));
  check("(10b) sorted by cost, each card leads with the cheapest home it lists that is within the comfort range and not a Stretch",
    costCards.every((c) => comfortableRows(c).length > 0 && comfortableRows(c).every((r) => c.monthly <= r.monthly)),
    costCards.map((c) => c.city + " " + c.monthly + " vs " + comfortableRows(c).map((r) => r.monthly).join("/")).join("; "));
  const cheapestAnywhere = Math.min(...costCards.flatMap((c) => comfortableRows(c).map((r) => r.monthly)));
  check("(10c) ...so the #1 card is the cheapest comfortable home on the page",
    costCards.length > 0 && costCards[0].monthly === cheapestAnywhere, (costCards[0] && costCards[0].city + " " + costCards[0].monthly) + " vs " + cheapestAnywhere);
  check("(10d) ...and the cards go from cheapest to dearest", costCards.every((c, i) => i === 0 || costCards[i - 1].monthly <= c.monthly), costCards.map((c) => c.monthly).join(","));
  check("(10e) the rule sentence says what the sort compares", /each place shows the cheapest home you can comfortably afford/.test(win.document.getElementById("rankNotes").textContent));
  win.eval("setResultsSort('home')");
  const homeCards = cardsWithRows();
  check("(10f) 'Most home' is unchanged: each card still leads with the biggest home it lists within comfort",
    homeCards.length > 0 && homeCards.every((c) => comfortableRows(c).every((r) => RANK[c.type] >= RANK[r.type])),
    homeCards.map((c) => c.city + " " + c.type).join("; "));

  // =============== 11. two incomes (IMPROVEMENT_PLAN.md 3.3) ===============
  // The form asked for one "household income" and taxed it as if one person
  // earned it all, so a couple on $65K each was shown about $560 a month less
  // take-home than they have, and every percentage on every card too high.
  const SOLO = { ...COUPLE, income: 130000, work: "hybrid" };
  const PAIR = { ...COUPLE, income: 65000, partnerIncome: 65000, work: "hybrid" };
  search(win, SOLO);
  const soloBP = win.eval("buyPower"), soloNet = win.eval("netMonthlyIncome");
  search(win, PAIR);
  const pairBP = win.eval("buyPower"), pairNet = win.eval("netMonthlyIncome");
  check("(11a) buying power is the same either way: lenders add the two incomes", pairBP > 0 && soloBP === pairBP, soloBP + " vs " + pairBP);
  check("(11b) two $65K earners get more take-home than one $130K earner ($500+/month)", pairNet - soloNet > 500, Math.round(soloNet) + " -> " + Math.round(pairNet));
  win.eval("setResultsSort('home')");
  // The limit is still the 30 minutes section 10 picked, and this couple has no
  // comfortable place within it (nor within the 60-minute default) even on two
  // incomes, so their cards are the stretch ones; those show % of take-home too.
  const pairCards = [...mainCards(win), ...moreCards(win)];
  check("(11c) each card's % of take-home is worked out on the two-earner take-home",
    pairCards.length > 0 && pairCards.every((c) => { const m = /(\d+)% of take-home/.exec(c.text); return !!m && Math.abs(Number(m[1]) - (c.monthly / pairNet) * 100) <= 1; }),
    pairCards.slice(0, 3).map((c) => c.city + " " + c.monthly + " " + (/(\d+)% of take-home/.exec(c.text) || [])[1] + "%").join("; "));
  // The wording is the 2026-09-24 top section's (2.2); section 14 checks the whole line.
  check("(11d) the summary shows both incomes", /Based on \$130,000\/yr \(\$65,000 \+ \$65,000\)/.test(win.document.getElementById("bpSub").textContent),
    (/Based on[^·]*/.exec(win.document.getElementById("bpSub").textContent) || [""])[0]);
  win.eval("saveBuyerProfile()");
  const pairProfile = JSON.parse(win.sessionStorage.getItem("hp_buyer_profile_v1"));
  check("(11f) the listing pages get the two-earner take-home", Math.abs(pairProfile.netMonthlyIncome - pairNet) < 0.01);
  // (11g checked the lead's incomes; the lead form was removed 2026-09-23.)
  sentBody = null;
  await win.eval("shareScenario()");
  check("(11h) a shared link stores the household total, so it keeps the same buying power", !!sentBody && sentBody.inc === 130000, JSON.stringify(sentBody));
  // Working remotely, the same couple does get ranked places to compare.
  search(win, { ...PAIR, work: "remote" });
  const remoteFirst = mainCards(win)[0];
  const snap2 = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  check("(11e) Scenarios keep the split: the same household income gives the same #1 place",
    !!remoteFirst && !!snap2.picks && snap2.picks.home.n === remoteFirst.city, (snap2.picks && snap2.picks.home.n) + " vs " + (remoteFirst && remoteFirst.city));
  search(win, { ...PAIR, partnerIncome: -5000, income: 100000 });
  check("(11i) a negative income is refused with a visible message",
    win.document.getElementById("err").style.display === "block" && /can't be negative/.test(win.document.getElementById("err").textContent));
  // (11j checked the partner box's translations; the site went English only 2026-09-23.)

  // =============== 12. no pre-filled answers (IMPROVEMENT_PLAN.md 2.5) ===============
  // "Work arrangement" and "First-time buyer" used to arrive answered
  // ("Remote" and "No"), so a buyer who skipped them got results built on
  // answers they never gave. Both now start unanswered, and no results appear
  // until both are chosen. A fresh page, because the one above has answers.
  const fresh = await openCalculator();
  const fw = fresh.win, fd = fw.document;
  const scrolledTo = [];
  fw.Element.prototype.scrollIntoView = function () { scrolledTo.push(this.id); };
  try { fw.localStorage.removeItem("hp_consent"); } catch (e) { /* no storage: consent is not given either way */ }
  const GREEN = /#1D9E75|rgb\(29, 158, 117\)/i;
  const shows = (id) => fd.getElementById(id).style.display === "block";
  const noResults = () => fw.eval("results.length") === 0 && fd.getElementById("bpBox").style.display !== "block"
    && fd.querySelectorAll("#list .city, #listMore .city").length === 0;
  const waSel = fd.getElementById("waSelect");
  check("(12a) work arrangement starts unanswered: the select reads 'Choose one' and the page holds no answer",
    waSel.value === "" && waSel.options[waSel.selectedIndex].textContent === "Choose one" && fw.eval("workArrangement") === null,
    waSel.value + " / " + fw.eval("workArrangement"));
  check("(12a2) ...and the hint under it is empty until the buyer answers (it used to describe Remote, the old pre-selected answer)",
    fd.getElementById("wa_hint").textContent.trim() === "", fd.getElementById("wa_hint").textContent);
  check("(12b) first-time buyer starts unanswered: neither Yes nor No is highlighted",
    fw.eval("firstTimeBuyer") === null && !GREEN.test(fd.getElementById("ftb-yes").style.background) && !GREEN.test(fd.getElementById("ftb-no").style.background),
    fd.getElementById("ftb-yes").style.background + " / " + fd.getElementById("ftb-no").style.background);
  check("(12c) the browser can't refill an old work arrangement on reload (autocomplete off)", waSel.getAttribute("autocomplete") === "off");
  check("(12d) no question message shows before the buyer tries to continue", !shows("wa_err") && !shows("ftb_err"));
  fd.getElementById("inc").value = "130000";
  fd.getElementById("dwn").value = "70000";
  fd.getElementById("dbt").value = "450";
  fd.getElementById("goBtn").click();
  check("(12e) pressing the button with neither answered shows no results", noResults());
  check("(12f) ...and a clear message next to each question, in the form's error style",
    shows("wa_err") && shows("ftb_err") && fd.getElementById("wa_err").classList.contains("err") && fd.getElementById("ftb_err").classList.contains("err")
      && /remote, hybrid or daily/.test(fd.getElementById("wa_err").textContent) && /Yes or No/.test(fd.getElementById("ftb_err").textContent)
      && fd.getElementById("workArrangementCard").contains(fd.getElementById("wa_err")) && fd.getElementById("ftbCard").contains(fd.getElementById("ftb_err")));
  check("(12g) ...before the consent pop-up, which stays closed", fd.getElementById("consentModalOverlay").style.display !== "flex");
  check("(12h) ...and the first unanswered question is brought into view, with its select focused",
    scrolledTo[scrolledTo.length - 1] === "workArrangementCard" && fd.activeElement === waSel, scrolledTo.join(",") + " / " + (fd.activeElement && fd.activeElement.id));
  fw.eval("go()");
  check("(12i) go() itself refuses too (a shared link or a returning visitor reaches it directly)", noResults() && shows("wa_err") && shows("ftb_err"));
  fw.eval("setWorkArrangement('office')");
  check("(12j) only remote, hybrid or daily count as an answer", fw.eval("workArrangement") === null && waSel.value === "");
  waSel.value = "hybrid";
  waSel.dispatchEvent(new fw.Event("change"));
  fd.getElementById("workCity").value = "Toronto";
  check("(12k) choosing a work arrangement clears its message at once", !shows("wa_err") && fw.eval("workArrangement") === "hybrid" && fw.eval("maxCommuteMin") === 60);
  check("(12k2) ...and the hint now describes the answer given (hybrid: the longest commute)", /longest commute/.test(fd.getElementById("wa_hint").textContent), fd.getElementById("wa_hint").textContent);
  fw.eval("go()");
  check("(12l) with only the work arrangement answered: still no results, and only the first-time message shows",
    noResults() && !shows("wa_err") && shows("ftb_err"));
  check("(12m) ...and the page brings the first-time question into view", scrolledTo[scrolledTo.length - 1] === "ftbCard", scrolledTo.join(","));
  fd.getElementById("ftb-yes").click();
  check("(12n) choosing Yes clears its message and highlights Yes only",
    !shows("ftb_err") && fw.eval("firstTimeBuyer") === true && GREEN.test(fd.getElementById("ftb-yes").style.background) && !GREEN.test(fd.getElementById("ftb-no").style.background));
  fw.eval("go()");
  check("(12o) with both answered, results appear, built on the answers given",
    fw.eval("results.length") > 0 && fd.getElementById("bpBox").style.display === "block" && fd.querySelectorAll("#list .city, #listMore .city").length > 0
      && fw.eval("workZone") !== null && /30-year amortization \(first-time buyer\)/.test(fd.getElementById("rateNote").textContent),
    fd.getElementById("rateNote").textContent.slice(0, 120));

  // A shared link restores the answers it carries. It has no first-time
  // answer (the share service keeps seven fields), so it stops and asks.
  const shared = await openCalculator();
  const sw = shared.win, sd = sw.document;
  try { sw.localStorage.removeItem("hp_consent"); } catch (e) { /* as above */ }
  sw.fetch = async () => ({ ok: true, json: async () => ({ inc: 130000, dn: 70000, dbt: 450, fam: "3", wa: "hybrid", wp: "" }) });
  sw.history.replaceState(null, "", "?s=test-link");
  await sw.eval("loadScenarioFromURL()");
  await new Promise((r) => setTimeout(r, 300));
  check("(12p) a shared link fills in the work arrangement it carries", sd.getElementById("waSelect").value === "hybrid" && sw.eval("workArrangement") === "hybrid");
  check("(12q) ...but not a first-time answer, so it stops at that question: no results, no pop-up yet",
    sw.eval("firstTimeBuyer") === null && sd.getElementById("ftb_err").style.display === "block" && sd.getElementById("wa_err").style.display !== "block"
      && sw.eval("results.length") === 0 && sd.getElementById("consentModalOverlay").style.display !== "flex");
  check("(12r) no script errors on either fresh page", fresh.errors.length === 0 && shared.errors.length === 0, [...fresh.errors, ...shared.errors].join(" | "));

  // =============== 13. the shorter form (IMPROVEMENT_PLAN.md 2.3a) ===============
  // Nothing was removed: every setting that left the form still works, from a
  // one-line stand-in, from the results, or as a small box.
  const sf = await openCalculator();
  const s = sf.win, sd2 = s.document;
  // jsdom does no layout. The form hides and shows its parts with inline
  // display:none, so "visible" is: no display:none on the element or above it.
  const visible = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (e.hidden || e.style.display === "none") return false; } return !!el; };
  const textOf = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
  const labelFor = (id) => sd2.querySelector(`label[for="${id}"]`);
  const form = sd2.getElementById("calculatorSection");

  // L1-L3: wording.
  const incCard = sd2.getElementById("inc").closest(".card");
  check("(13a) L1: one heading, 'Household income (before tax)', with 'Your income' and 'Partner's income (optional)' under it",
    textOf(incCard.querySelector(".lbl span")) === "Household income (before tax)" && textOf(labelFor("inc")) === "Your income"
      && textOf(labelFor("inc2")) === "Partner's income (optional)" && incCard.contains(sd2.getElementById("inc2")) && !/\(before tax\) \(optional\)|Your income \(before tax\)/.test(textOf(incCard)),
    textOf(incCard).slice(0, 200));
  check("(13b) L2: the hint under income: yearly salary before tax, not what reaches the bank",
    visible(sd2.getElementById("incHint")) && incCard.contains(sd2.getElementById("incHint"))
      && textOf(sd2.getElementById("incHint")) === "Your yearly salary before tax, as on your job offer or T4, not what reaches your bank account.");
  const dbtCard = sd2.getElementById("dbt").closest(".card");
  check("(13c) L3: 'Household monthly debt payments', with the hint that it covers both people",
    textOf(dbtCard.querySelector(".lbl span")) === "Household monthly debt payments" && visible(sd2.getElementById("dbtHint"))
      && textOf(sd2.getElementById("dbtHint")) === "Car loans, credit cards, student loans, for both of you." && !/Existing monthly debt/.test(form.textContent));

  // The count the plan names: a daily commuter who is a first-time buyer.
  const wa13 = sd2.getElementById("waSelect");
  wa13.value = "daily"; wa13.dispatchEvent(new s.Event("change"));
  sd2.getElementById("ftb-yes").click();
  const shownFields = [...form.querySelectorAll("input[type=number], input[type=text], select")].filter(visible).map((e) => e.id);
  const shownYesNo = ["ftb-yes"].filter((id) => visible(sd2.getElementById(id))).length;
  const shownBoxes = [...form.querySelectorAll("input[type=checkbox]")].filter(visible).map((e) => e.id);
  const questions = shownFields.length + shownYesNo;
  console.log(`  INFO - a daily commuter now sees ${questions} questions (${shownFields.join(", ")} + the first-time Yes/No), plus ${shownBoxes.length} small box (${shownBoxes.join(", ")}); it was 13`);
  check("(13d) a daily commuter sees 8 questions, down from 13: two incomes, down payment, debt, work arrangement, work city, first-time buyer, family size",
    questions === 8 && shownFields.join(",") === "inc,inc2,dwn,dbt,waSelect,workCity,fam", shownFields.join(",") + " + " + shownYesNo);
  check("(13d2) ...plus the one small citizenship box near the bottom; no other box on the form", shownBoxes.join(",") === "nonResident", shownBoxes.join(","));

  // A: the commute limit.
  const mcLine = sd2.getElementById("maxCommuteLine"), mcSel = sd2.getElementById("maxCommute");
  check("(13e) A: the commute limit is one line, 'Showing places within 60 minutes · change', with the drop-down closed",
    visible(mcLine) && textOf(mcLine) === "Showing places within 60 minutes · change" && !visible(mcSel) && s.eval("maxCommuteMin") === 60, textOf(mcLine));
  mcLine.querySelector("button").click();
  check("(13f) 'change' opens the same drop-down, every choice still there, showing 60, with the cursor in it",
    visible(mcSel) && !visible(mcLine) && [...mcSel.options].map((o) => o.value).join(",") === "30,45,60,75,90,none" && mcSel.value === "60" && sd2.activeElement === mcSel);
  mcSel.value = "none"; mcSel.dispatchEvent(new s.Event("change"));
  check("(13g) picking 'No limit' there takes effect, and the line records it", s.eval("maxCommuteMin") === null && s.eval("maxCommuteTouched") === true
    && textOf(sd2.getElementById("maxCommuteLineText")) === "Showing places with no commute limit");

  // B: the preferred area.
  const areaLine = sd2.getElementById("areaLine"), areaSel = sd2.getElementById("area");
  check("(13h) B: the preferred area is one line, 'All areas · change', with the drop-down closed",
    visible(areaLine) && textOf(areaLine) === "All areas · change" && !visible(areaSel) && areaSel.value === "all", textOf(areaLine));
  areaLine.querySelector("button").click();
  check("(13i) 'change' opens the same drop-down, all nine areas, with the cursor in it",
    visible(areaSel) && !visible(areaLine) && areaSel.options.length === 9 && sd2.activeElement === areaSel && visible(sd2.getElementById("area-tooltip").parentElement));
  areaSel.value = "gta"; areaSel.dispatchEvent(new s.Event("change"));
  check("(13j) ...and the line follows the choice", textOf(sd2.getElementById("areaLineText")) === "City of Toronto + Peel");

  // C: the work postal code.
  const postalAdd = sd2.getElementById("workPostalAdd"), postal = sd2.getElementById("workPostal");
  check("(13k) C: the postal code is a link under work city, '+ add postal code for a more accurate commute', with its box closed",
    visible(postalAdd) && textOf(postalAdd) === "+ add postal code for a more accurate commute" && !visible(postal)
      && sd2.getElementById("workCity").parentElement.contains(postalAdd) && (sd2.getElementById("workCity").compareDocumentPosition(postalAdd) & 4) !== 0);
  postalAdd.click();
  check("(13l) the link opens the same postal box, with the cursor in it", visible(postal) && !visible(postalAdd) && sd2.activeElement === postal);

  // All three, used by a real search: no limit, Toronto + Peel only, and the
  // postal code's area rather than the work city's.
  sd2.getElementById("inc").value = "150000";
  sd2.getElementById("dwn").value = "120000";
  sd2.getElementById("workCity").value = "Toronto";
  postal.value = "L4W 5L5";
  s.eval("go()");
  const areaCards = [...sd2.querySelectorAll("#list .city, #listMore .city")];
  check("(13m) a search uses all three: the postal code's work area, only Toronto + Peel, and no commute limit",
    s.eval("workZone") === s.eval("FSA_TO_WORK_ZONE['L4W']") && s.eval("workZone") !== s.eval("CITY_TO_WORK_ZONE['toronto']")
      && s.eval("results.length") > 0 && s.eval("results.every(function(r){ return r.r === 'gta'; })") && areaCards.length > 0
      && !/hidden — estimated drive/.test(sd2.getElementById("rankNotes").textContent),
    s.eval("workZone") + " / " + s.eval("results.map(function(r){ return r.n + ':' + r.r; }).join(',')"));

  // A second page: the lines say what is in force without being opened.
  const lf = await openCalculator();
  const l = lf.win, ld = l.document;
  const lLine = ld.getElementById("maxCommuteLine");
  l.eval("setWorkArrangement('remote')");
  check("(13n) a remote worker gets no commute line (as the drop-down before it), but does get the area line",
    !visible(lLine) && !visible(ld.getElementById("workPostalAdd")) && visible(ld.getElementById("areaLine")));
  l.eval("setWorkArrangement('hybrid')");
  check("(13o) hybrid: the line shows, at the 60-minute default", visible(lLine) && textOf(lLine) === "Showing places within 60 minutes · change");
  l.eval("setMaxCommute('45')");
  const at45 = textOf(ld.getElementById("maxCommuteLineText"));
  l.eval("setMaxCommute('none')");
  check("(13p) ...and it keeps up with the limit however it is set: 45 minutes, then no limit",
    at45 === "Showing places within 45 minutes" && textOf(ld.getElementById("maxCommuteLineText")) === "Showing places with no commute limit" && !visible(ld.getElementById("maxCommute")), at45);
  ld.getElementById("area").value = "niag";
  l.eval("syncFormLines()");
  check("(13q) the area line names the area in force", textOf(ld.getElementById("areaLineText")) === "Niagara / Hamilton");
  ld.getElementById("workPostal").value = "M5V 2T6";
  l.eval("setWorkArrangement('daily')");
  check("(13r) a postal code already filled in is shown open, never used unseen", visible(ld.getElementById("workPostal")) && !visible(ld.getElementById("workPostalAdd")));

  // A shared link that carries a postal code opens with the box open, and
  // with the citizenship and rebate answers at their defaults (the share
  // service keeps seven fields; neither is one of them).
  const sh2 = await openCalculator();
  const sw2 = sh2.win, sd3 = sw2.document;
  try { sw2.localStorage.removeItem("hp_consent"); } catch (e) { /* as above */ }
  sw2.fetch = async () => ({ ok: true, json: async () => ({ inc: 150000, dn: 120000, dbt: 0, fam: "3", wa: "daily", wp: "L4W 5L5" }) });
  sw2.history.replaceState(null, "", "?s=test-link-2");
  await sw2.eval("loadScenarioFromURL()");
  await new Promise((r) => setTimeout(r, 300));
  check("(13s) a shared link with a postal code shows its box open, filled in",
    visible(sd3.getElementById("workPostal")) && sd3.getElementById("workPostal").value === "L4W 5L5" && !visible(sd3.getElementById("workPostalAdd")));
  check("(13t) ...and starts as a citizen or PR with no rebate, the defaults", sw2.eval("canadianResident") === true && !sd3.getElementById("nonResident").checked && sw2.eval("lttRebateConfirmed") === false);

  // E: citizenship.
  const nrBox = sd2.getElementById("nonResident");
  const famCard = sd2.getElementById("fam").closest(".card");
  check("(13u) E: the Yes/No citizenship card is gone", !sd2.getElementById("residencyCard") && !sd2.getElementById("res-yes") && !sd2.getElementById("res-no") && !/Are you a Canadian citizen/.test(form.textContent));
  check("(13v) ...replaced by one small box near the bottom, after family size and before the button, unticked",
    !!nrBox && nrBox.type === "checkbox" && !nrBox.checked && textOf(nrBox.closest("label")) === "I'm not a Canadian citizen or permanent resident"
      && (famCard.compareDocumentPosition(nrBox) & 4) !== 0 && (nrBox.compareDocumentPosition(sd2.getElementById("goBtn")) & 4) !== 0
      && s.eval("canadianResident") === true && nrBox.getAttribute("autocomplete") === "off");
  nrBox.click();
  s.eval("go()");
  const firstCard = sd2.querySelector("#list .city, #listMore .city");
  const firstRow = firstCard ? firstCard.querySelector("[id^='pt-row-']:not([id$='-chevron'])") : null;
  if (firstRow) firstRow.click();
  const nrPanel = firstCard ? [...firstCard.querySelectorAll("[id^='pt-panel-']")].find((p) => p.style.display === "block") : null;
  check("(13w) ticked is today's 'No': non-resident taxes in cash to close and the federal-ban note",
    s.eval("canadianResident") === false && visible(sd2.getElementById("nonResidentHint")) && /January 1, 2027/.test(sd2.getElementById("bpSub").textContent)
      && !!nrPanel && /Ontario Non-Resident Speculation Tax \(25%\)/.test(nrPanel.textContent) && !nrPanel.querySelector(".ltt-rebate-box"));
  nrBox.click();
  s.eval("go()");
  check("(13x) unticked is today's 'Yes': no note, no non-resident tax", s.eval("canadianResident") === true && !visible(sd2.getElementById("nonResidentHint"))
    && !/January 1, 2027/.test(sd2.getElementById("bpSub").textContent));

  // D: the rebate box, in the cash-to-close breakdown.
  check("(13y) D: the 'never owned a home anywhere' box has left the form", !sd2.getElementById("lttRebate") && !sd2.getElementById("ltt_rebate_row") && !/ever owned a home/.test(form.textContent));
  const rebateOf = (t) => Number((/First-Time Buyer Rebate-\$([\d,]+)/.exec(t) || [0, "0"])[1].replace(/,/g, ""));
  search(win, { ...TOR, firstTime: true, neverOwnedAnywhere: false });
  breakdown("Toronto - Scarborough", torType);
  const torCard = win.document.getElementById(torId), openPanel = torPanel(torType);
  // A second breakdown open on another card, to show every open one follows.
  const otherCard = [...win.document.querySelectorAll("#list .city")].find((el) => el.id !== torId);
  const otherRow = otherCard ? otherCard.querySelector("[id^='pt-row-']:not([id$='-chevron'])") : null;
  if (otherRow) otherRow.click();
  const otherPanel = otherCard ? [...otherCard.querySelectorAll("[id^='pt-panel-']")].find((p) => p.style.display === "block") : null;
  const beforeTick = openPanel.textContent, otherBefore = otherPanel ? otherPanel.textContent : "";
  written.length = 0;
  win.open = () => { const w = { html: "", document: { write(h) { w.html += h; }, close() {} }, focus() {}, print() {}, close() {} }; written.push(w); return w; };
  win.eval("downloadReport()");
  const reportBefore = (written[0] || { html: "" }).html;
  const whatIfBefore = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  const rebateBox = openPanel.querySelector(".ltt-rebate-box");
  const rebateRowEl = rebateBox.closest("label");
  const ltRows = [...openPanel.querySelectorAll("div")].filter((el) => /^(Provincial|Toronto) Land Transfer Tax/.test(el.textContent) && el.children.length === 2);
  check("(13z) the box sits right after the land transfer tax lines, where the rebate line goes",
    ltRows.length === 2 && ltRows[1].nextElementSibling === rebateRowEl && !rebateBox.checked);
  rebateBox.click();
  const afterTick = openPanel.textContent;
  check("(13aa) ticking it adds the rebate line and takes the rebate off cash to close at once",
    win.eval("lttRebateConfirmed") === true && rebateOf(afterTick) > 4000 && cash(beforeTick) - cash(afterTick) === rebateOf(afterTick) && !/rebate not included/.test(afterTick),
    `${cash(beforeTick)} -> ${cash(afterTick)}, rebate ${rebateOf(afterTick)}`);
  const newBox = openPanel.querySelector(".ltt-rebate-box");
  check("(13ab) ...without losing the buyer's place: same card, same breakdown open, the box ticked and still focused, the rebate line just above it",
    win.document.getElementById(torId) === torCard && torPanel(torType) === openPanel && openPanel.style.display === "block"
      && !!newBox && newBox.checked && win.document.activeElement === newBox
      && /First-Time Buyer Rebate/.test(newBox.closest("label").previousElementSibling.textContent));
  check("(13ac) ...and the other open breakdown follows the same answer",
    !!otherPanel && otherPanel.style.display === "block" && rebateOf(otherPanel.textContent) > 0 && cash(otherBefore) - cash(otherPanel.textContent) === rebateOf(otherPanel.textContent)
      && otherPanel.querySelector(".ltt-rebate-box").checked, otherCard && otherCard.id);
  const handKey = win.eval("handOffBuyerProfile()");
  const handed = JSON.parse(win.localStorage.getItem("hp_profile_handoff_v1:" + handKey)).profile;
  win.localStorage.removeItem("hp_profile_handoff_v1:" + handKey);
  check("(13ad) the listing pages get the tick: the handover a listings link sends reads it", handed.lttRebateEligible === true && handed.firstTimeBuyer === true && handed.canadianResident === true);
  written.length = 0;
  win.eval("downloadReport()");
  const reportAfter = (written[0] || { html: "" }).html;
  const whatIfAfter = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  win.open = realOpen;
  check("(13ae) the PDF report and Scenarios carry no closing costs, so the tick leaves them exactly as they were",
    reportBefore.length > 0 && reportAfter === reportBefore && !/rebate/i.test(reportAfter)
      && JSON.stringify(whatIfAfter) === JSON.stringify(whatIfBefore));
  sentBody = null;
  await win.eval("shareScenario()");
  check("(13af) a shared link still holds only its seven fields, so the tick cannot travel in it",
    !!sentBody && Object.keys(sentBody).sort().join(",") === "dbt,dn,fam,inc,rate,wa,wp", JSON.stringify(sentBody));
  openPanel.querySelector(".ltt-rebate-box").click();
  check("(13ag) unticking takes the rebate back out", win.eval("lttRebateConfirmed") === false && !/First-Time Buyer Rebate/.test(openPanel.textContent)
    && cash(openPanel.textContent) === cash(beforeTick) && /rebate not included/.test(openPanel.textContent));
  openPanel.querySelector(".ltt-rebate-box").click();
  win.eval("setFTB(false)");
  check("(13ah) answering 'No' to first-time buyer clears the tick, as it did on the form", win.eval("lttRebateConfirmed") === false);
  win.eval("setFTB(true)");

  // 2.5 still holds on the shorter form: the two required questions start
  // unanswered (section 12 checks the rest on its own fresh page).
  check("(13ai) first-time buyer still starts unanswered on the shorter form (12a-12q check the rest)",
    l.eval("firstTimeBuyer") === null && !GREEN.test(ld.getElementById("ftb-yes").style.background) && !GREEN.test(ld.getElementById("ftb-no").style.background));
  check("(13aj) no script errors on the section 13 pages", sf.errors.length === 0 && lf.errors.length === 0 && sh2.errors.length === 0, [...sf.errors, ...lf.errors, ...sh2.errors].join(" | "));

  // =============== 14. the top section (IMPROVEMENT_PLAN.md 2.2) ===============
  // It showed "Your estimated buying power", "Bank qualifies you for" and
  // "HomePilot comfort range", often all the same figure, and two paragraphs
  // of small print. Now: one number, then one small line each.
  const d = win.document;
  const byId = (id) => d.getElementById(id);
  // The top section as a buyer reads it: without the parts that are closed.
  const shownText = (el) => {
    const c = el.cloneNode(true);
    [...c.querySelectorAll("*")].forEach((e) => { if (e.style && e.style.display === "none") e.remove(); });
    return c.textContent.replace(/\s+/g, " ").trim();
  };
  const money = (t) => t.match(/\$[\d,]+/g) || [];
  const fcw = (n) => win.eval(`fc(${n})`);
  // Distinct amounts on purpose, so a figure shown twice can only be a repeat.
  const TOP = { income: 70000, partnerIncome: 60000, down: 75000, debt: 450, family: 3, firstTime: true, work: "remote" };
  search(win, TOP);
  const comfort = win.eval("comfortBuyPower"), bank = win.eval("buyPower");
  const top = shownText(byId("bpBox"));
  check("(14a) one number: 'Your HomePilot comfort range', the comfort buying power, 'Stay here to breathe financially'",
    textOf(byId("bpBox").querySelector(".bp-lbl")) === "Your HomePilot comfort range" && textOf(byId("bpV")) === fcw(comfort)
      && textOf(byId("bpV").nextElementSibling) === "Stay here to breathe financially", top.slice(0, 120));
  check("(14b) the other two top figures are gone, and no amount in the top section repeats",
    !/Your estimated buying power|Bank qualifies you for|✓ HomePilot comfort range/.test(byId("bpBox").textContent)
      && money(top).length >= 6 && new Set(money(top)).size === money(top).length && money(top).filter((m) => m === fcw(comfort)).length === 1,
    money(top).join(" "));
  check("(14c) the bank line, small, under it: 'A bank might lend up to $X, but above your HomePilot comfort range is stretch territory.'",
    bank > comfort && textOf(byId("bpBankLine")) === `A bank might lend up to ${fcw(bank)}, but above your HomePilot comfort range is stretch territory.`
      && byId("bpBankLine").className === "bp-line", textOf(byId("bpBankLine")));
  check("(14d) 'Based on' with two incomes: household total, the two in brackets, the down payment and the debt",
    textOf(byId("bpBasedOn")) === "Based on $130,000/yr ($70,000 + $60,000) · $75,000 down · $450/mo debt", textOf(byId("bpBasedOn")));
  const estimate = win.eval("householdNetAnnual(grossMonthlyIncome*12)/12");
  check("(14e) 'Estimated take-home: $N/mo · Know your actual pay? Change it', N from householdNetAnnual()",
    textOf(byId("takeHomeLine")) === `Estimated take-home: ${fcw(estimate)}/mo · Know your actual pay? Change it` && win.eval("netMonthlyIncome") === estimate,
    textOf(byId("takeHomeLine")));
  check("(14f) the small print is one line, 'Estimate only, not a pre-approval · How we calculated this', its details closed",
    textOf(byId("bpFine")) === "Estimate only, not a pre-approval · How we calculated this" && !visible(byId("calcDetails"))
      && !/Stress tested|Educational estimate only|most a lender might approve/.test(top), top.slice(-200));
  byId("calcDetailsBtn").click();
  const details = textOf(byId("calcDetails"));
  check("(14g) 'How we calculated this' opens all of it: the rate, amortization, stress test, not a pre-approval, and how the two figures differ",
    visible(byId("calcDetails")) && byId("calcDetailsBtn").getAttribute("aria-expanded") === "true" && byId("calcDetails").contains(byId("rateNote"))
      && /Based on 4\.19% mortgage rate · 30-year amortization \(first-time buyer\) · Stress tested at 6\.19%/.test(details)
      && /not a mortgage pre-approval\. Actual qualification depends on lender underwriting, credit, and full application details\./.test(details)
      && /not a pre-approval\. Tap any city below to see the full monthly cost breakdown\./.test(details), details.slice(0, 200));
  const bpSrc = win.eval("calcBP.toString()");
  check("(14h) ...and the ratios it names are calcBP()'s own (32% / 38% comfort, 39% / 44% bank)",
    /bestPrice\(0\.32, 0\.38\)/.test(bpSrc) && /bestPrice\(0\.39, 0\.44\)/.test(bpSrc) && /within 32% of your before-tax income, and those plus your other debt payments within 38%\. A bank goes up to 39% and 44%/.test(details));
  byId("calcDetailsBtn").click();
  check("(14i) ...and closes again", !visible(byId("calcDetails")) && byId("calcDetailsBtn").getAttribute("aria-expanded") === "false");
  search(win, { ...TOP, income: 130000, partnerIncome: 0, debt: 0 });
  check("(14j) one income: no brackets; no debt: 'no debt'", textOf(byId("bpBasedOn")) === "Based on $130,000/yr · $75,000 down · no debt", textOf(byId("bpBasedOn")));

  // When savings are the limit: the bank would lend the same, so it says so
  // instead of naming a figure again. The "$X more saved" tip stays (it is to
  // become the first HomePilot Worth Knowing tip) and savingsLimitTip() gives it.
  const SAVER = { income: 200000, down: 20000, debt: 0, family: 3, firstTime: false, work: "remote" };
  search(win, SAVER);
  const saverCalc = win.eval("calcBP(200000, 20000, 0)"), saverTop = shownText(byId("bpBox"));
  check("(14k) savings the limit: 'Your savings are the limit, not your income. A bank would lend the same.', and the number shows once",
    saverCalc.downPaymentLimited && saverCalc.bp === saverCalc.comfortBP && textOf(byId("bpBankLine")) === "Your savings are the limit, not your income. A bank would lend the same."
      && money(saverTop).filter((m) => m === fcw(saverCalc.comfortBP)).length === 1 && !/A bank might lend/.test(saverTop), saverTop.slice(0, 260));
  const tip = win.eval("savingsLimitTip(lastSearch.calc)");
  check("(14l) the savings tip is still worked out (savingsLimitTip(), calcBP()'s figures) and still shown, without repeating the line's words",
    !!tip && tip.incomeCapBP === saverCalc.incomeCapBP && tip.moreSaved === saverCalc.downPaymentShortfall && tip.moreSaved > 0
      && textOf(byId("savingsTip")).includes(`about ${fcw(tip.moreSaved)} more saved would get you there`) && !/limit here, not your income/.test(saverTop), JSON.stringify(tip));
  const capped = win.eval("calcBP(200000, 60000, 0)");
  search(win, { ...SAVER, down: 60000 });
  check("(14m) savings cap the bank but the HomePilot comfort range sits well under it: the bank line, not the savings line",
    capped.downPaymentLimited && capped.bp - capped.comfortBP > 10000
      && textOf(byId("bpBankLine")) === `A bank might lend up to ${fcw(capped.bp)}, but above your HomePilot comfort range is stretch territory.`, JSON.stringify(capped));

  // Take-home: the buyer's own figure.
  search(win, TOP);
  const est = win.eval("netMonthlyIncome"), gross = win.eval("grossMonthlyIncome");
  const LBL = win.eval("[T.en.fit_great_lbl, T.en.fit_good_lbl, T.en.fit_stretch_lbl]");
  const fitLabelFor = (ratio) => (ratio < 0.35 ? LBL[0] : ratio < 0.45 ? LBL[1] : LBL[2]);
  const pctOf = (c) => { const m = /(\d+)% of take-home/.exec(c.text); return m ? Number(m[1]) : null; };
  // Every property row on every card: its %, its label and its monthly cost.
  const allRows = () => [...d.querySelectorAll("#list .city, #listMore .city")].flatMap((el) => [...el.querySelectorAll("[id^='pt-row-']:not([id$='-chevron'])")].map((r) => {
    const m = /\$[\d,]+ · \$([\d,]+)\/mo/.exec(r.textContent), p = /(\d+)%/.exec(r.textContent.replace(/\$[\d,]+/g, ""));
    return { monthly: m ? Number(m[1].replace(/,/g, "")) : null, pct: p ? Number(p[1]) : null, label: (LBL.find((l) => r.textContent.includes(l)) || null) };
  }));
  const cardsBefore = [...mainCards(win), ...moreCards(win)], rowsBefore = allRows();
  const fixedBefore = { bank: win.eval("buyPower"), comfort: win.eval("comfortBuyPower"), bpv: textOf(byId("bpV")), line: textOf(byId("bpBankLine")) };
  byId("takeHomeChange").click();
  const input = byId("takeHomeInput");
  check("(14n) 'Change it' opens a small box right there for the actual monthly take-home, both people together, with the cursor in it",
    visible(byId("takeHomeEdit")) && d.activeElement === input && /Your actual monthly take-home, both of you together/.test(textOf(byId("takeHomeEdit")))
      && byId("takeHomeChange").getAttribute("aria-expanded") === "true");
  const tryValue = (v) => { input.value = v; byId("takeHomeEdit").querySelector(".bp-apply-btn").click(); return { err: visible(byId("takeHomeErr")) ? textOf(byId("takeHomeErr")) : "", net: win.eval("netMonthlyIncome") }; };
  const bad = ["", "0", "-500", String(Math.ceil(gross) + 1)].map(tryValue);
  check("(14o) it refuses nothing, zero, a negative, and more than income before tax, with a message, and changes nothing",
    bad.every((r) => r.err && r.net === est) && /more than your income before tax \(\$10,833\/mo\)/.test(bad[3].err) && /Estimated take-home/.test(textOf(byId("takeHomeLine"))),
    bad.map((r) => r.err).join(" | "));
  const OWN = 6000;
  tryValue(String(OWN));
  const cardsAfter = [...mainCards(win), ...moreCards(win)], rowsAfter = allRows();
  check("(14p) applied: the line says it is the buyer's own, 'Your take-home: $6,000/mo · reset to estimate', and the box closes",
    textOf(byId("takeHomeLine")) === "Your take-home: $6,000/mo · reset to estimate" && win.eval("netMonthlyIncome") === OWN && !!byId("takeHomeEdit") && !visible(byId("takeHomeEdit")),
    textOf(byId("takeHomeLine")));
  check("(14q) ...and the buying power does not move: the HomePilot comfort range, the bank's figure and its line are unchanged",
    win.eval("buyPower") === fixedBefore.bank && win.eval("comfortBuyPower") === fixedBefore.comfort && textOf(byId("bpV")) === fixedBefore.bpv && textOf(byId("bpBankLine")) === fixedBefore.line);
  check("(14r) every card's % of take-home is on the buyer's figure",
    cardsAfter.length > 0 && cardsAfter.every((c) => pctOf(c) === Math.round(c.monthly / OWN * 100)),
    cardsAfter.slice(0, 3).map((c) => c.city + " " + c.monthly + " " + pctOf(c) + "%").join("; "));
  check("(14s) every card's fit label and every home-type row's % and label are on it too",
    cardsAfter.every((c) => c.fit === fitLabelFor(c.monthly / OWN)) && rowsAfter.length > 0
      && rowsAfter.every((r) => r.pct === Math.round(r.monthly / OWN * 100) && r.label === fitLabelFor(r.monthly / OWN)),
    rowsAfter.filter((r) => r.pct !== Math.round(r.monthly / OWN * 100) || r.label !== fitLabelFor(r.monthly / OWN)).slice(0, 3).map((r) => JSON.stringify(r)).join(" "));
  check("(14t) ...which really changed what the page says (labels and %s were on the estimate before)",
    rowsBefore.every((r) => r.pct === Math.round(r.monthly / est * 100) && r.label === fitLabelFor(r.monthly / est))
      && rowsBefore.some((r) => r.label !== fitLabelFor(r.monthly / OWN)) && cardsBefore.some((c) => pctOf(c) !== Math.round(c.monthly / OWN * 100)));
  const cnt14 = byId("cnt").textContent, n14 = Number((/(\d+)\s+(?:city|cities)/.exec(cnt14) || [])[1] || 0);
  check("(14u) the count of places still matches the cards (the stricter labels can move places to 'Only as a stretch')",
    mainCards(win).length === 0 ? /No cities/.test(cnt14) : n14 === mainCards(win).length && mainCards(win).every((c) => c.fit !== LBL[2]), cnt14);
  // A breakdown, the PDF report, Compare, Scenarios and the listings handover.
  const anyCard = d.querySelector("#list .city, #listMore .city");
  const anyRow = anyCard.querySelector("[id^='pt-row-']:not([id$='-chevron'])");
  anyRow.click();
  const panel14 = [...anyCard.querySelectorAll("[id^='pt-panel-']")].find((p) => p.style.display === "block");
  const housing = panel14 ? Number((/Housing Cost\$([\d,]+)\/mo/.exec(panel14.textContent) || [0, "0"])[1].replace(/,/g, "")) : 0;
  check("(14v) an opened cost breakdown uses it: 'Net Monthly Income $6,000/mo' and its % of income",
    !!panel14 && /Net Monthly Income\$6,000\/mo/.test(panel14.textContent) && new RegExp("% of Income Consumed" + Math.round(housing / OWN * 100) + "%").test(panel14.textContent),
    panel14 && panel14.textContent.slice(0, 300));
  written.length = 0;
  win.open = () => { const w = { html: "", document: { write(h) { w.html += h; }, close() {} }, focus() {}, print() {}, close() {} }; written.push(w); return w; };
  win.eval("downloadReport()");
  const rep = (written[0] || { html: "" }).html;
  const ladder = [...rep.matchAll(/pr-ladder-cost">\$([\d,]+)\/mo<\/span><span class="pr-ladder-pct[^"]*">(\d+)%/g)].map((m) => ({ monthly: Number(m[1].replace(/,/g, "")), pct: Number(m[2]) }));
  check("(14w) the PDF report: every % is on the buyer's take-home, which it names as theirs",
    ladder.length > 0 && ladder.every((r) => r.pct === Math.round(r.monthly / OWN * 100)) && /Your Take-home<\/div><div class="pr-profile-val">\$6,000\/mo/.test(rep), ladder.slice(0, 4).map((r) => JSON.stringify(r)).join(" "));
  const ticked14 = cardsAfter.slice(0, 2);
  written.length = 0;
  win.eval(`cmpSelected=${JSON.stringify(ticked14.map((c) => c.city))}; buildCompare();`);
  const cmp14 = written[0] && written[0].html ? new win.DOMParser().parseFromString(written[0].html, "text/html") : null;
  const cmpFits = cmp14 ? [...cmp14.querySelectorAll(".cmp-fit")].map((e) => e.textContent.trim()) : [];
  check("(14x) Compare's labels are the cards' labels on the buyer's take-home", ticked14.length === 2 && cmpFits.join("|") === ticked14.map((c) => c.fit).join("|"), cmpFits.join("|") + " vs " + ticked14.map((c) => c.fit).join("|"));
  win.eval("cmpSelected=[]");
  win.open = realOpen;
  const snap14 = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  const first14 = mainCards(win)[0];
  check("(14y) Scenarios work on it too: the same answers give the screen's #1 at the screen's %, and the page keeps the buyer's figure",
    !!first14 && !!snap14.picks && snap14.picks.home.n === first14.city && snap14.picks.home.pct === pctOf(first14) && win.eval("netMonthlyIncome") === OWN,
    (snap14.picks && snap14.picks.home.n + " " + snap14.picks.home.pct) + " vs " + (first14 && first14.city + " " + pctOf(first14)));
  check("(14z) ...and a what-if income moves the buyer's figure as the estimate moves (same share of it)",
    Math.abs(win.eval("takeHomeMonthlyFor(grossMonthlyIncome*12*1.2)") - OWN * win.eval("householdNetAnnual(grossMonthlyIncome*12*1.2)") / win.eval("householdNetAnnual(grossMonthlyIncome*12)")) < 0.01);
  const hk = win.eval("handOffBuyerProfile()");
  const handed14 = JSON.parse(win.localStorage.getItem("hp_profile_handoff_v1:" + hk)).profile;
  win.localStorage.removeItem("hp_profile_handoff_v1:" + hk);
  check("(14aa) the listing pages get it, marked as the buyer's own", handed14.netMonthlyIncome === OWN && handed14.takeHomeIsOwn === true, JSON.stringify(handed14));

  // A new search keeps it while the incomes are the same, and not otherwise.
  search(win, { ...TOP, down: 90000 });
  check("(14ab) a new search with the same incomes (a different down payment) keeps the buyer's take-home",
    win.eval("netMonthlyIncome") === OWN && textOf(byId("takeHomeLine")) === "Your take-home: $6,000/mo · reset to estimate");
  byId("takeHomeReset").click();
  const cardsReset = [...mainCards(win), ...moreCards(win)];
  check("(14ac) 'reset to estimate' goes back to the estimate, everywhere",
    win.eval("netMonthlyIncome") === win.eval("estimatedNetMonthlyIncome") && /^Estimated take-home: /.test(textOf(byId("takeHomeLine")))
      && cardsReset.length > 0 && cardsReset.every((c) => pctOf(c) === Math.round(c.monthly / win.eval("netMonthlyIncome") * 100))
      && win.eval("readLiveBuyerProfile().takeHomeIsOwn") === false);
  byId("takeHomeChange").click();
  tryValue(String(OWN));
  search(win, { ...TOP, income: 72000 });
  check("(14ad) a new search with a different income goes back to the estimate",
    win.eval("netMonthlyIncome") === win.eval("householdNetAnnual(grossMonthlyIncome*12)/12") && /^Estimated take-home: /.test(textOf(byId("takeHomeLine"))) && win.eval("takeHomeOverride") === null);
  search(win, { ...TOP, income: 70000, partnerIncome: 0 });
  check("(14ae) one income: the box asks for 'Your actual monthly take-home', with no 'both of you'",
    textOf(byId("takeHomeEdit").querySelector("label")) === "Your actual monthly take-home");

  check("(8) no uncaught script errors during any of this", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
