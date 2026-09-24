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
//      exactly the cards on screen (shownCards), with "See all places" closed
//      and open, and before and after a re-sort.
//   4. The comfort label and the comfort budget never contradict each other
//      on a card.
//   5. "N cities" counts only cities with a comfortable home; stretch-only
//      cities are listed separately.
//   6. The What-If scenario's #1 is the screen's #1 (one ranking).
//   7. Smaller fixes: the rate note's amortization, neutral icons, the sort
//      (inside "See all places" since 2.2), no Ottawa for a Toronto worker.
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
//  15. Three answers and "See all places" (IMPROVEMENT_PLAN.md 2.2): the
//      three answer cards are today's cards, each the winner of its own sort
//      (rankCities()), labelled; identical homes share a card; a remote
//      buyer's third card; "See all places" closed until opened, with the
//      rest of the places and its own sort; side by side on a computer,
//      stacked on a phone.
//  16. HomePilot Worth Knowing and the "you're close" empty page
//      (IMPROVEMENT_PLAN.md 2.2, 2.0): the box between the answers and "See
//      all places", each tip checked against the page by searching again with
//      the answer it changes; the empty page's heading, its three closest
//      options (today's stretch cards, labelled Stretch), "you're close" only
//      when a tip gets there, the plan's worked example at 60 and 90 minutes,
//      and no drive tip for remote buyers.
//
// Since 2026-09-24 (2.2) the results are three answer cards (#answers), then
// "See all places" (#list, #listMore inside #seeAllBody), drawn only while it
// is open. mainCards() opens it and reads every comfortable card in screen
// order: the answers, then the rest.
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
    id: el.id,
    city: el.querySelector(".cn").textContent.trim(),
    type: m ? m[1].trim() : null,
    price: m ? Number(m[2].replace(/,/g, "")) : null,
    monthly: monthly ? Number(monthly.textContent.replace(/[^0-9]/g, "")) : null,
    fit: el.querySelector(".fit-pill") ? el.querySelector(".fit-pill").textContent.trim() : null,
    drive: dm ? Number(dm[1]) : null,
    text: el.textContent,
  };
}
// "See all places" draws its cards only while open (2.2), so the readers
// below open it first, as a buyer would.
const openSeeAll = (win) => { if (!win.eval("seeAllOpen")) win.eval("toggleSeeAll()"); };
// The answer cards, then the rest of the comfortable places, in screen order.
// On the empty page (2.0) #answers holds the three closest options instead,
// labelled Stretch (data-answers="closest"); they are not answers.
const ANSWER_CARDS = "#answers .answer-slot:not([data-answers='closest']) .city";
const answerCards = (win) => [...win.document.querySelectorAll(ANSWER_CARDS)].map(readCard);
const closestCards = (win) => [...win.document.querySelectorAll("#answers .answer-slot[data-answers='closest'] .city")].map(readCard);
const seeAllCards = (win) => { openSeeAll(win); return [...win.document.querySelectorAll("#list .city")].map(readCard); };
const mainCards = (win) => { openSeeAll(win); return [...win.document.querySelectorAll(ANSWER_CARDS + ", #list .city")].map(readCard); };
const moreCards = (win) => { openSeeAll(win); return [...win.document.querySelectorAll("#listMore .city")].map(readCard); };
// Every card element on the page, See all opened.
const cardEls = (win) => { openSeeAll(win); return [...win.document.querySelectorAll("#answers .city, #list .city, #listMore .city")]; };
// The places the comfortable cards show (a place can have two cards).
const placesOf = (cards) => new Set(cards.map((c) => c.city)).size;
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
    // 2.2: a place can have two cards (an answer and its card under "See all
    // places" with a different home), so the count is of places.
    check(`(5a) "N cities" equals the places the comfortable cards show (${tag})`, cards.length === 0 ? /fits your HomePilot comfort range yet/.test(cnt) : Number(n) === placesOf(cards), `${cnt} vs ${placesOf(cards)}`);
    const stretchCards = [...win.document.querySelectorAll("#listMore .more-section")].filter((s) => /Only as a stretch/.test(s.textContent));
    check(`(5b) stretch-only cities sit in their own section, below (${tag})`, stretchCards.every((s) => [...s.querySelectorAll(".city")].every((el) => /beyond comfortable/.test(el.textContent))));
  }

  // =============== 3. the old lead form is gone ===============
  // Removed 2026-09-23 by the user's decision, to be rebuilt properly later.
  // Until then nothing on the page collects a lead, and WhatsApp is the way
  // to reach Sandeep.
  // At the 60-minute default (section 1 left "No limit" picked), where this
  // buyer's answers show one place twice with two homes (3j2).
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
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
  // Since 2026-09-24 (2.2) the screen is the three answer cards, then "See
  // all places", whose cards are drawn only while it is open; every line of
  // shownCards also says which part of the page its card is in.
  const drawnEls = () => [...win.document.querySelectorAll("#answers .city, #list .city, #listMore .city")];
  const cardsOnScreen = () => drawnEls().map(readCard);
  const sectionOf = (el) => {
    const slot = el.closest(".answer-slot");
    if (slot) return "answer-" + slot.dataset.answers.split(" ")[0];
    const more = el.closest(".more-section");
    if (!more) return "ranked";
    return /Only as a stretch/.test(more.querySelector(".sec-title").textContent) ? "stretch" : "over";
  };
  const cityOrder = (list) => list.map((c) => c.city).join("|");
  const matchesScreen = (rec, screen) => rec.length === screen.length && rec.every((m, i) =>
    m.city === screen[i].city && TYPE_LABEL[m.type] === screen[i].type && m.price === screen[i].price && Math.round(m.monthlyCost) === screen[i].monthly && m.cardId === screen[i].id);
  const sectionsMatch = (rec) => { const els = drawnEls(); return rec.length === els.length && rec.every((m, i) => m.section === sectionOf(els[i])); };
  const cardDetail = (rec, screen) => JSON.stringify(rec.slice(0, 2)) + " vs " + JSON.stringify(screen.slice(0, 2).map(({ text, ...c }) => c));
  // downloadReport() and buildCompare() write into a new window; jsdom has
  // none, so capture what they write.
  const written = [];
  const realOpen = win.open, realAlert = win.alert;
  win.open = () => { const w = { html: "", document: { write(h) { w.html += h; }, close() {} }, focus() {}, print() {}, close() {} }; written.push(w); return w; };
  win.alert = (msg) => written.push({ html: "", alert: String(msg) });
  const reportCities = () => { written.length = 0; win.eval("downloadReport()"); const w = written[0] || { html: "" }; return { cities: [...w.html.matchAll(/class="pr-city-name">([^<]*)</g)].map((x) => x[1]), alert: w.alert }; };

  // "See all places" closed, as after every search: the answer cards only.
  const closedScreen = cardsOnScreen();
  const recClosed = win.eval("shownCards").map((c) => ({ ...c }));
  check("(3e) See all closed: shownCards is exactly the answer cards on screen, same order, each marked with its answer",
    closedScreen.length > 0 && closedScreen.length <= 3 && win.document.querySelectorAll("#list .city, #listMore .city").length === 0
      && matchesScreen(recClosed, closedScreen) && sectionsMatch(recClosed) && recClosed.every((c) => /^answer-(home|commute|cost|also)$/.test(c.section) && Array.isArray(c.answers)),
    JSON.stringify(recClosed.map((c) => c.city + ":" + c.type + ":" + c.section)) + " vs " + cityOrder(closedScreen));
  const reportClosed = reportCities();
  check("(3e2) ...and the PDF report lists those cards, in the same order",
    !reportClosed.alert && reportClosed.cities.join("|") === cityOrder(closedScreen), (reportClosed.alert || reportClosed.cities.join("|")) + "  vs  " + cityOrder(closedScreen));
  // The report leads with the page's one number, then the bank's (2.2), and
  // names the home each card is about: this buyer has two cards of one place.
  const repHtml = written[0] ? written[0].html : "";
  const repHomes = [...repHtml.matchAll(/class="pr-city-sub pr-city-home">([^<]*)</g)].map((x) => x[1]);
  const LBL_OF = { home: "Most home", commute: "Shortest commute", cost: "Lowest monthly cost", also: "Also worth a look" };
  check("(3e2b) ...its profile gives the HomePilot comfort range, then 'A bank might lend up to', and no 'Buying Power'",
    repHtml.includes('HomePilot comfort range</div><div class="pr-profile-val">' + win.eval("fc(comfortBuyPower)") + "<")
      && repHtml.includes('A bank might lend up to</div><div class="pr-profile-val">' + win.eval("fc(buyPower)") + "<") && !/Buying Power/.test(repHtml),
    repHtml.slice(repHtml.indexOf("pr-profile"), repHtml.indexOf("pr-profile") + 600));
  check("(3e2c) ...and each card in it names its home and its answer, so two cards of one place read as two homes",
    repHomes.length === closedScreen.length && repHomes.every((h, i) => h === closedScreen[i].type + " · " + win.eval("fc(" + closedScreen[i].price + ")") + " · " + recClosed[i].answers.map((q) => LBL_OF[q]).join(" · ")),
    JSON.stringify(repHomes));

  openSeeAll(win);
  const onScreen = cardsOnScreen();
  const rec = win.eval("shownCards").map((c) => ({ ...c }));
  check("(3e3) See all open: shownCards is every card on screen, same order: the answers, then 'ranked' (then 'stretch' / 'over')",
    onScreen.length > closedScreen.length && cityOrder(rec) === cityOrder(onScreen) && sectionsMatch(rec)
      && rec.slice(closedScreen.length).every((c) => ["ranked", "stretch", "over"].includes(c.section)),
    cityOrder(rec) + "  vs  " + cityOrder(onScreen));
  check("(3f) ...with each card's own home type, price, monthly cost and id", matchesScreen(rec, onScreen), cardDetail(rec, onScreen));
  const report = reportCities();
  check("(3g) the PDF report lists the first five cards on screen, same order",
    !report.alert && report.cities.join("|") === cityOrder(onScreen.slice(0, 5)), (report.alert || report.cities.join("|")) + "  vs  " + cityOrder(onScreen.slice(0, 5)));

  // The sort is inside "See all places" now: it reorders the rest, never the answers.
  win.eval("setResultsSort('cost')");
  const reordered = cardsOnScreen();
  const rec2 = win.eval("shownCards").map((c) => ({ ...c }));
  check("(3h) re-sorting See all changes shownCards the same way it changes the screen, and leaves the answers as they were",
    matchesScreen(rec2, reordered) && sectionsMatch(rec2) && JSON.stringify(rec2.slice(0, closedScreen.length)) === JSON.stringify(recClosed)
      && cityOrder(rec2) !== cityOrder(rec),
    cityOrder(rec2).slice(0, 160) + "  vs  " + cityOrder(reordered).slice(0, 160));
  const report2 = reportCities();
  check("(3i) ...and the PDF report follows the new order",
    !report2.alert && report2.cities.join("|") === cityOrder(reordered.slice(0, 5)), (report2.alert || report2.cities.join("|")) + "  vs  " + cityOrder(reordered.slice(0, 5)));

  // Compare, ticked on the cards themselves. Where a place has two cards on the
  // page (this buyer: a most-home card and a lowest-cost card of the same
  // place, 2.2), tick both: each must compare its own home.
  const twoOfAPlace = reordered.find((c, i) => reordered.findIndex((o) => o.city === c.city) !== i);
  const ticked = twoOfAPlace ? reordered.filter((c) => c.city === twoOfAPlace.city).slice(0, 2) : reordered.slice(0, 2);
  ticked.forEach((c) => win.document.getElementById("cmp-chk-" + c.id).click());
  const selected = win.eval("cmpSelected.slice()");
  written.length = 0;
  win.eval("buildCompare()");
  const cmpDoc = written[0] && written[0].html ? new win.DOMParser().parseFromString(written[0].html, "text/html") : null;
  const cmpHeads = cmpDoc ? [...cmpDoc.querySelectorAll(".cmp-head-name")].map((e) => e.textContent.trim()) : [];
  const cmpTypes = cmpDoc ? [...cmpDoc.querySelectorAll(".cmp-head-type")].map((e) => e.textContent.trim()) : [];
  const cmpRow = (i) => { const row = cmpDoc ? cmpDoc.querySelectorAll(".cmp-row")[i] : null; return row ? [...row.querySelectorAll(".cmp-cell")].slice(1).map((e) => Number(e.textContent.replace(/[^0-9]/g, ""))) : []; };
  check("(3j) Compare shows the home each ticked card showed: same places, price and monthly cost" + (twoOfAPlace ? " (two cards of " + twoOfAPlace.city + ", two different homes)" : ""),
    selected.join("|") === ticked.map((c) => c.id).join("|")
      && cmpHeads.join("|") === cityOrder(ticked) && cmpRow(0).join("|") === ticked.map((c) => c.price).join("|") && cmpRow(1).join("|") === ticked.map((c) => c.monthly).join("|")
      && ticked.every((c) => win.document.getElementById(c.id).classList.contains("cmp-on")),
    JSON.stringify({ selected, cmpHeads, prices: cmpRow(0), monthly: cmpRow(1) }) + " vs " + JSON.stringify(ticked.map(({ id, city, price, monthly }) => ({ id, city, price, monthly }))));
  check("(3j2) ...this buyer does have a place with two cards and two different homes (Most home and Lowest monthly cost)",
    !!twoOfAPlace && ticked[0].type !== ticked[1].type && ticked[0].price !== ticked[1].price, twoOfAPlace ? JSON.stringify(ticked.map((c) => c.id + " " + c.type)) : "none");
  // Two columns of one place: each names its home type, so the buyer can tell
  // the townhouse from the condo; the bar counts what was ticked without
  // calling it cities; the line under the title leads with the page's number.
  const cmpSub = cmpDoc ? [...cmpDoc.querySelectorAll("div")].map((e) => e.textContent).find((x) => /^Comparing \d+ /.test(x)) || "" : "";
  check("(3j2b) ...each Compare column names its home type, the bar says '2 selected', and the line under the title gives the HomePilot comfort range, not the bank's figure",
    cmpTypes.join("|") === ticked.map((c) => c.type).join("|") && new Set(cmpHeads.map((h, i) => h + " " + cmpTypes[i])).size === ticked.length
      && win.document.getElementById("cmpStickyLabel").textContent === "2 selected"
      && cmpSub === "Comparing 2 homes · Your HomePilot comfort range: " + win.eval("fc(comfortBuyPower)") && win.eval("buyPower") !== win.eval("comfortBuyPower"),
    JSON.stringify({ cmpHeads, cmpTypes, bar: win.document.getElementById("cmpStickyLabel").textContent, cmpSub }));
  ticked.forEach((c) => win.document.getElementById("cmp-chk-" + c.id).click());
  check("(3j3) unticking both empties the selection", win.eval("cmpSelected.length") === 0);
  // A new search starts Compare afresh. A tick keeps the home its card showed,
  // so a tick carried into new answers compared homes from the old search:
  // some no longer on the page, some above the new budget.
  ticked.forEach((c) => win.document.getElementById("cmp-chk-" + c.id).click());
  search(win, { ...COUPLE, income: 180000, down: 90000, work: "hybrid", maxCommute: "60" });
  const sticky3 = win.document.getElementById("cmpSticky");
  check("(3j4) a new search clears Compare: nothing ticked, no compare bar, no 'N selected' left over",
    win.eval("cmpSelected.length") === 0 && win.eval("Object.keys(cmpTicked).length") === 0 && (!sticky3 || sticky3.style.display === "none")
      && !win.document.body.classList.contains("cmp-bar-open") && win.document.querySelectorAll(".city.cmp-on").length === 0,
    win.eval("JSON.stringify(cmpSelected)"));
  const newScreen = cardsOnScreen().slice(0, 2);
  newScreen.forEach((c) => win.document.getElementById("cmp-chk-" + c.id).click());
  written.length = 0;
  win.eval("buildCompare()");
  const cmpNew = written[0] && written[0].html ? new win.DOMParser().parseFromString(written[0].html, "text/html") : null;
  const newPrices = cmpNew ? [...cmpNew.querySelectorAll(".cmp-row")[0].querySelectorAll(".cmp-cell")].slice(1).map((e) => Number(e.textContent.replace(/[^0-9]/g, ""))) : [];
  check("(3j5) ...and cards ticked after it compare the new search's homes",
    newScreen.length === 2 && newPrices.join("|") === newScreen.map((c) => c.price).join("|") && newScreen.every((c) => c.price <= win.eval("buyPower")),
    newPrices.join("|") + " vs " + newScreen.map((c) => c.price).join("|"));
  newScreen.forEach((c) => win.document.getElementById("cmp-chk-" + c.id).click());
  win.eval("cmpSelected=[]");
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
  win.open = realOpen; win.alert = realAlert;
  // Back to the "No limit" section 1 left, which the sections below expect.
  win.eval("setMaxCommute('none')");

  // Stands in for the network, so the share test (11h) can read what would be saved.
  let sentBody = null;
  win.fetch = async (u, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };

  // =============== 6. one ranking for the screen and the scenarios ===============
  win.eval("setResultsSort('home')");
  const screenFirst = mainCards(win)[0];
  win.eval("openScenarioSandbox()");
  const snap = win.eval("_getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone)");
  check("(6) the What-If scenario's #1 place is the #1 card on screen (the Most home answer)",
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
  const glanceEls = cardEls(win);
  const glance = glanceEls.flatMap((el) => [...el.querySelectorAll("div")].filter((d) => /At a glance/.test(d.textContent) && d.children.length > 1));
  const ticks = glanceEls.map((el) => el.innerHTML).join("");
  check("(7g) no green tick sits next to a stretch or a commute fact (P1-6)",
    !/✓<\/span><span>[^<]*(stretch|Estimated commute)/.test(ticks) && glance.length > 0);
  // Since 2.2 the three orders are the three answer cards, and the sort lives
  // inside "See all places", where it orders the rest.
  const answerFor = (q) => { const slot = [...win.document.querySelectorAll("#answers .answer-slot")].find((s) => s.dataset.answers.split(" ").includes(q)); return slot ? readCard(slot.querySelector(".city")) : null; };
  win.eval("setResultsSort('cost')");
  const byCost = seeAllCards(win), cheapest = answerFor("cost");
  check("(7h) 'Lowest monthly cost': the answer card is the cheapest, and See all goes from cheapest to dearest after it",
    !!cheapest && byCost.length > 1 && byCost.every((c, i) => (i === 0 ? cheapest.monthly : byCost[i - 1].monthly) <= c.monthly), (cheapest && cheapest.monthly) + " | " + byCost.map((c) => c.monthly).join(","));
  win.eval("setResultsSort('commute')");
  const byDrive = seeAllCards(win), closest = answerFor("commute");
  check("(7i) 'Shortest commute': the answer card is the shortest drive, and See all goes from shortest to longest after it",
    !!closest && byDrive.length > 1 && byDrive.every((c, i) => (i === 0 ? closest.drive : byDrive[i - 1].drive) <= c.drive), (closest && closest.drive) + " | " + byDrive.map((c) => c.drive).join(","));
  check("(7j) the rule in force is stated in one sentence, inside See all", /Ranked by shortest estimated drive to work/.test(win.document.getElementById("seeAllRule").textContent)
    && !/Ranked by/.test(win.document.getElementById("rankNotes").textContent));
  search(win, { ...COUPLE, work: "remote" });
  openSeeAll(win);
  check("(7k) remote: no 'Shortest commute' sort or answer, no commute limit",
    win.document.getElementById("seeAllSort-commute").style.display === "none" && !/Shortest commute/.test(win.document.getElementById("answers").textContent) && win.eval("maxCommuteMin") === null);
  check("(7l) the property list uses the one fit function: no '<35 / <=45' leftovers in the page code",
    !/pct<35\)\{fitLbl='Great Fit'/.test(win.eval("render.toString()+selectPropType.toString()+costPanelHtml.toString()")));

  // =============== 9. newcomers: the rebate and non-resident taxes (1.7) ===============
  // Opens one Toronto city's cost breakdown the way a buyer taps it.
  // The place's first card: an answer card, or its card under "See all
  // places", which is opened first (2.2).
  const breakdown = (city, type) => {
    openSeeAll(win);
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
  // Since 2026-09-24 (2.2) an order is its answer card (the winner) followed
  // by the rest of the places under "See all places", sorted the same way.
  const cardsWithRows = (q) => {
    const slot = [...win.document.querySelectorAll("#answers .answer-slot")].find((s) => s.dataset.answers.split(" ").includes(q));
    openSeeAll(win);
    return [slot ? slot.querySelector(".city") : null, ...win.document.querySelectorAll("#list .city")].filter(Boolean).map((el) => ({ ...readCard(el), rows: rowsOf(el) }));
  };
  search(win, REPORTED);
  const comfortCap = win.eval("comfortBuyPower");
  const comfortableRows = (c) => c.rows.filter((r) => !r.stretch && r.price !== null && r.price <= comfortCap);
  win.eval("setResultsSort('cost')");
  const costCards = cardsWithRows("cost");
  check("(10a) the reported buyer gets several places to compare", costCards.length >= 2 && costCards.every((c) => c.rows.length > 0), String(costCards.length));
  check("(10b) sorted by cost, each card leads with the cheapest home it lists that is within the comfort range and not a Stretch",
    costCards.every((c) => comfortableRows(c).length > 0 && comfortableRows(c).every((r) => c.monthly <= r.monthly)),
    costCards.map((c) => c.city + " " + c.monthly + " vs " + comfortableRows(c).map((r) => r.monthly).join("/")).join("; "));
  const cheapestAnywhere = Math.min(...[...win.document.querySelectorAll("#answers .city, #list .city")].flatMap((el) => comfortableRows({ rows: rowsOf(el) }).map((r) => r.monthly)));
  check("(10c) ...so the 'Lowest monthly cost' card is the cheapest comfortable home on the page",
    costCards.length > 0 && costCards[0].monthly === cheapestAnywhere, (costCards[0] && costCards[0].city + " " + costCards[0].monthly) + " vs " + cheapestAnywhere);
  check("(10d) ...and See all goes on from cheapest to dearest", costCards.every((c, i) => i === 0 || costCards[i - 1].monthly <= c.monthly), costCards.map((c) => c.monthly).join(","));
  check("(10e) the rule sentence says what the sort compares", /each place shows the cheapest home that fits your HomePilot comfort range there/.test(win.document.getElementById("seeAllRule").textContent));
  win.eval("setResultsSort('home')");
  const homeCards = cardsWithRows("home");
  check("(10f) 'Most home' is unchanged: the answer and each card in See all lead with the biggest home they list within comfort",
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
  // incomes, so their cards are the stretch ones: the closest options at the
  // top (2.0) and the rest under "See all places"; those show % of take-home too.
  const pairCards = [...mainCards(win), ...closestCards(win), ...moreCards(win)];
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
    && fd.querySelectorAll("#answers .city, #list .city, #listMore .city").length === 0;
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
    fw.eval("results.length") > 0 && fd.getElementById("bpBox").style.display === "block" && fd.querySelectorAll("#answers .city, #list .city, #listMore .city").length > 0
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
  // The commute hint ("Places past your longest commute are set aside...")
  // sits right under the commute limit it describes, above the area line; it
  // sat under the area, where it read as a note about the area.
  const hint13 = sd2.getElementById("wa_hint");
  check("(13j2) the commute hint follows the commute fields and comes before the area line",
    hint13.previousElementSibling === sd2.getElementById("workLocationFields") && hint13.nextElementSibling === sd2.getElementById("areaLine"));

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
  const areaCards = [...sd2.querySelectorAll("#answers .city, #list .city, #listMore .city")];
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
  const firstCard = sd2.querySelector("#answers .city, #list .city, #listMore .city");
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
  const otherCard = [...win.document.querySelectorAll("#answers .city, #list .city")].find((el) => el.id !== torId);
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
  // instead of naming a figure again. The "$X more saved" tip stays, worked
  // out by savingsLimitTip(); since 2026-09-24 it is the first HomePilot Worth
  // Knowing tip, under the answer cards, not a note in the top section.
  const SAVER = { income: 200000, down: 20000, debt: 0, family: 3, firstTime: false, work: "remote" };
  search(win, SAVER);
  const saverCalc = win.eval("calcBP(200000, 20000, 0)"), saverTop = shownText(byId("bpBox"));
  check("(14k) savings the limit: 'Your savings are the limit, not your income. A bank would lend the same.', and the number shows once",
    saverCalc.downPaymentLimited && saverCalc.bp === saverCalc.comfortBP && textOf(byId("bpBankLine")) === "Your savings are the limit, not your income. A bank would lend the same."
      && money(saverTop).filter((m) => m === fcw(saverCalc.comfortBP)).length === 1 && !/A bank might lend/.test(saverTop), saverTop.slice(0, 260));
  const tip = win.eval("savingsLimitTip(lastSearch.calc)");
  check("(14l) the savings tip is still worked out (savingsLimitTip(), calcBP()'s figures for the HomePilot comfort range), in the plan's words, and shown as the first HomePilot Worth Knowing tip, not in the top section",
    !!tip && tip.comfortCapBP === saverCalc.comfortIncomeCapBP && tip.moreSaved === saverCalc.comfortDownPaymentShortfall && tip.moreSaved > 0
      && textOf(byId("savingsTip")).endsWith(`Your savings are the limit, not your income. On your income alone your HomePilot comfort range would be ${fcw(tip.comfortCapBP)}; about ${fcw(tip.moreSaved)} more saved would get you there.`) && !/limit here, not your income/.test(saverTop)
      && byId("worthKnowing").contains(byId("savingsTip")) && byId("worthKnowing").querySelector(".wk-tip") === byId("savingsTip")
      && !byId("bpBox").contains(byId("savingsTip")) && !/more saved would get you there/.test(byId("bpBox").textContent), JSON.stringify(tip));
  const capped = win.eval("calcBP(200000, 60000, 0)");
  search(win, { ...SAVER, down: 60000 });
  check("(14m) savings cap the bank but the HomePilot comfort range sits well under it: the bank line, not the savings line",
    capped.downPaymentLimited && capped.bp - capped.comfortBP > 10000
      && textOf(byId("bpBankLine")) === `A bank might lend up to ${fcw(capped.bp)}, but above your HomePilot comfort range is stretch territory.`, JSON.stringify(capped));
  // A $10,000 gap is not "the same": the bank lends more, and income, not
  // savings, caps the HomePilot comfort range (it read "Your savings are the
  // limit... A bank would lend the same." until 2026-09-24).
  search(win, { income: 80000, down: 15000, debt: 0, family: 3, firstTime: true, work: "daily" });
  const gap10 = win.eval("lastSearch.calc");
  check("(14m2) $80K, $15K down: HomePilot comfort range $10,000 under the bank's figure, so the line names the bank's figure",
    gap10.downPaymentLimited && gap10.bp - gap10.comfortBP === 10000
      && textOf(byId("bpBankLine")) === `A bank might lend up to ${fcw(gap10.bp)}, but above your HomePilot comfort range is stretch territory.`, JSON.stringify(gap10) + " " + textOf(byId("bpBankLine")));
  const bankSweep = win.eval(`(function(){ var bad = [], n = 0, same = 0, ftSaved = firstTimeBuyer;
    [true, false].forEach(function(ft){ firstTimeBuyer = ft;
      for (var inc = 20000; inc <= 320000; inc += 15000) [10000, 15000, 25000, 50000, 70000, 100000].forEach(function(dn){ [0, 500, 1500].forEach(function(dbt){
        var c = calcBP(inc, dn, dbt), line = comfortBankLine(c); n++;
        var savings = line === 'Your savings are the limit, not your income. A bank would lend the same.';
        var bank = line === 'A bank might lend up to ' + fc(c.bp) + ', but above your HomePilot comfort range is stretch territory.';
        if (savings) same++;
        if (!(savings || bank) || (savings && !(c.bp === c.comfortBP && c.downPaymentLimited)) || (bank && c.bp === c.comfortBP && c.downPaymentLimited)) bad.push(inc + '/' + dn + '/' + dbt + ':' + line);
      }); }); });
    firstTimeBuyer = ftSaved; return { n: n, same: same, bad: bad.slice(0, 5) }; })()`);
  check(`(14m3) over ${bankSweep.n} buyers the line is one of the two decided wordings, and says "the same" only when the two figures are the same and savings cap them (${bankSweep.same} such buyers)`,
    bankSweep.bad.length === 0 && bankSweep.same > 0, JSON.stringify(bankSweep.bad));

  // Take-home: the buyer's own figure.
  search(win, TOP);
  const est = win.eval("netMonthlyIncome"), gross = win.eval("grossMonthlyIncome");
  const LBL = win.eval("[T.en.fit_great_lbl, T.en.fit_good_lbl, T.en.fit_stretch_lbl]");
  const fitLabelFor = (ratio) => (ratio < 0.35 ? LBL[0] : ratio < 0.45 ? LBL[1] : LBL[2]);
  const pctOf = (c) => { const m = /(\d+)% of take-home/.exec(c.text); return m ? Number(m[1]) : null; };
  // Every property row on every card: its %, its label and its monthly cost.
  const allRows = () => cardEls(win).flatMap((el) => [...el.querySelectorAll("[id^='pt-row-']:not([id$='-chevron'])")].map((r) => {
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
    mainCards(win).length === 0 ? /fits your HomePilot comfort range yet/.test(cnt14) : n14 === placesOf(mainCards(win)) && mainCards(win).every((c) => c.fit !== LBL[2]), cnt14);
  // A breakdown, the PDF report, Compare, Scenarios and the listings handover.
  const anyCard = cardEls(win)[0];
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
  win.eval(`cmpSelected=${JSON.stringify(ticked14.map((c) => c.id))}; buildCompare();`);
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

  // =============== 15. three answers and "See all places" (IMPROVEMENT_PLAN.md 2.2) ===============
  // The user's decision: the top three are three labelled answers, one per
  // question, each that question's winner; they are today's cards,
  // completely unchanged, a third of the width side by side on a computer and
  // stacked on a phone; the rest of the places are behind "See all places",
  // ordered by most home, with a small "Sort by" there.
  // A search keeps the commute limit picked earlier (section 10 picked 30
  // minutes), so the commuters below set the 60-minute default explicitly.
  win.eval("resetTakeHome()");
  const TYPE_KEY = { Condo: "condo", Townhouse: "town", "Semi-Detached": "semi", Detached: "detached" };
  // The answers as a buyer reads them: the label on top, then the card.
  const answersOnPage = () => [...d.querySelectorAll("#answers .answer-slot")].map((s) => {
    const c = readCard(s.querySelector(".city"));
    return { ...c, label: textOf(s.querySelector(".answer-label")), answers: s.dataset.answers.split(" "), key: c.city + "|" + TYPE_KEY[c.type], slot: s };
  });
  // Each order's ranking, from the engine, with the page's own commute limit and home-type filter.
  const engineRanked = (sort) => win.eval(`rankCities(results, {sort:${JSON.stringify(sort)}, maxCommute:maxCommuteMin, onlyType: activeProp!=='all'?activeProp:null}).ranked.map(function(e){ return {key: e.n+'|'+e.type, n: e.n, type: e.type, price: e.price, monthly: Math.round(e.costs.total)}; })`);
  const sameHome = (card, e) => !!card && !!e && card.city === e.n && TYPE_KEY[card.type] === e.type && card.price === e.price && card.monthly === e.monthly;
  const seeAllOpenNow = () => visible(byId("seeAllBody")) && byId("seeAllBtn").getAttribute("aria-expanded") === "true";
  const listCards = () => [...d.querySelectorAll("#list .city")].map(readCard);

  // A commuter whose three answers are three different homes, one place twice.
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
  const a15 = answersOnPage(), home15 = engineRanked("home"), commute15 = engineRanked("commute"), cost15 = engineRanked("cost");
  check("(15a) three answer cards, labelled 'Most home', 'Shortest commute', 'Lowest monthly cost', in that order",
    a15.length === 3 && a15.map((a) => a.label).join("|") === "Most home|Shortest commute|Lowest monthly cost", a15.map((a) => a.label).join("|"));
  check("(15b) ...each is its question's winner: the #1 of rankCities() sorted by most home, by shortest commute and by lowest monthly cost (place, home, price, monthly cost)",
    sameHome(a15[0], home15[0]) && sameHome(a15[1], commute15[0]) && sameHome(a15[2], cost15[0]),
    JSON.stringify(a15.map((a) => a.key)) + " vs " + JSON.stringify([home15[0], commute15[0], cost15[0]].map((e) => e && e.key)));
  const twice = a15.filter((a) => a.city === a15[2].city);
  check("(15c) the same place can win twice with a different home, and is shown both times, each card with its own id",
    twice.length === 2 && twice[0].type !== twice[1].type && twice[0].id !== twice[1].id && twice[1].id === twice[0].id + "__2", JSON.stringify(twice.map((a) => a.id + " " + a.type)));
  const todays = win.eval(`(function(){ var cards = document.querySelectorAll('#answers .city'); return answerPicks(results, {maxCommute: maxCommuteMin, onlyType: null}).picks.map(function(p, i){ return cityCardHtml(p.entry, 'ranked', cards[i].id); }); })()`);
  const asParsed = (html) => { const box = d.createElement("div"); box.innerHTML = html; return box.firstElementChild.outerHTML; };
  check("(15d) each answer card is today's card, exactly: the same HTML cityCardHtml() draws for every card (name, headline and label, true monthly cost, At a glance, the home-type rows, AI Insights, compare, View available homes)",
    todays.length === 3 && a15.every((a, i) => a.slot.querySelector(".city").outerHTML === asParsed(todays[i]))
      && a15.every((a) => { const el = a.slot.querySelector(".city"); return el.querySelector(".cn") && el.querySelector(".card-headline .fit-pill") && el.querySelector("[id$='-mtotal']") && /At a glance/.test(el.textContent) && el.querySelector("[id^='pt-row-']") && el.querySelector(".ai-insights-trigger") && el.querySelector(".cmp-cb") && el.querySelector(".view-btn"); }));
  check("(15e) each label sits on top of its card, in the site's small eyebrow style",
    a15.every((a) => a.slot.firstElementChild.className === "answer-label" && a.slot.children[1].classList.contains("city") && a.slot.children.length === 2));
  check("(15f) HomePilot Worth Knowing has its place: #worthKnowing between the answers and 'See all places', holding exactly what worthKnowingHtml() gives (section 16 checks what it says)",
    !!byId("worthKnowing") && byId("answers").nextElementSibling === byId("worthKnowing") && byId("worthKnowing").nextElementSibling === byId("seeAll")
      && byId("worthKnowing").innerHTML === win.eval("worthKnowingHtml(worthKnowing(answerPicks(results,{maxCommute:maxCommuteMin,onlyType:null}),null))"));
  check("(15g) the sort switch above the list is gone; the only 'Sort by' is inside 'See all places', below the answers",
    !byId("sortBar") && !byId("sort-home") && !byId("sort-commute") && !byId("sort-cost") && byId("seeAllBody").contains(byId("seeAllSort"))
      && (byId("answers").compareDocumentPosition(byId("seeAllSort")) & 4) !== 0 && d.querySelectorAll("[onclick*='setResultsSort']").length === 3
      && [...d.querySelectorAll("[onclick*='setResultsSort']")].every((b) => byId("seeAllSort").contains(b)));

  // "See all places": closed until opened.
  const answerKeys = new Set(a15.map((a) => a.key));
  const restOf = (ranked) => ranked.filter((e) => !answerKeys.has(e.key));
  const restHome = restOf(home15);
  // "N more" counts places the answers do not show, not cards: an answer place
  // can come back under "See all places" with another home.
  const answerPlaces15 = new Set(a15.map((a) => a.city));
  const morePlaces15 = new Set(restHome.map((e) => e.n).filter((n) => !answerPlaces15.has(n))).size;
  check("(15h) 'See all places' is closed after a search: the button says how many more places, nothing of it is drawn",
    visible(byId("seeAllBtn")) && textOf(byId("seeAllBtn")) === `See all places (${morePlaces15} more)` && byId("seeAllBtn").getAttribute("aria-expanded") === "false"
      && !visible(byId("seeAllBody")) && d.querySelectorAll("#list .city, #listMore .city").length === 0 && restHome.length > 0 && win.eval("seeAllOpen") === false,
    textOf(byId("seeAllBtn")) + " / " + morePlaces15);
  check("(15i) ...and the page counts every place: 'N cities' is all the places, the answers' included", Number((/(\d+)\s+cities/.exec(byId("cnt").textContent) || [])[1]) === home15.length);
  // The numbers add up: the places on the answer cards plus "N more" is the
  // count line's "N cities", also when a place is on an answer card and again
  // under "See all places" with another home (it said "8 more" beside 3
  // answers and "10 cities", and "52 more" beside 3 answers and "54 cities").
  const addsUp = (b) => {
    search(win, b);
    const n = Number((/(\d+)\s+cit(?:y|ies)/.exec(byId("cnt").textContent) || [])[1]);
    const more = Number((/\((\d+) more\)/.exec(textOf(byId("seeAllBtn"))) || [0, 0])[1]);
    const placesUp = new Set(answersOnPage().map((a) => a.city)).size;
    openSeeAll(win);
    const repeat = listCards().some((c) => answersOnPage().some((a) => a.city === c.city));
    return { ok: placesUp + more === n, repeat, detail: `${placesUp} + ${more} vs ${n}` };
  };
  const J = addsUp({ income: 300000, partnerIncome: 200000, down: 500000, debt: 0, family: 3, firstTime: false, work: "daily", workCity: "Toronto", maxCommute: "60" });
  const B3 = addsUp({ income: 250000, down: 300000, debt: 0, family: 3, firstTime: false, work: "remote" });
  check("(15i2) answer places + 'N more' = 'N cities', for two buyers who have an answer place again under 'See all places'",
    J.ok && B3.ok && J.repeat && B3.repeat, JSON.stringify({ J, B3 }));
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
  // An answer card's breakdown, open, to show the answers are left alone below.
  const firstAnswer = byId("answers").querySelector(".city");
  firstAnswer.querySelector("[id^='pt-row-']:not([id$='-chevron'])").click();
  const openPanel15 = [...firstAnswer.querySelectorAll("[id^='pt-panel-']")].find((p) => p.style.display === "block");
  byId("seeAllBtn").click();
  const opened = listCards();
  check("(15j) opening it shows the rest in today's big cards, ordered by most home: rankCities()'s order without the homes the answers already show",
    seeAllOpenNow() && textOf(byId("seeAllBtn")) === "Hide the other places" && opened.length === restHome.length && opened.every((c, i) => sameHome(c, restHome[i]))
      && [...d.querySelectorAll("#list > .city")].length === opened.length,
    opened.map((c) => c.city + "|" + c.type).join(", ") + " vs " + restHome.map((e) => e.key).join(", "));
  check("(15k) ...with its 'Sort by' (Most home picked) and the rule it follows",
    visible(byId("seeAllSort")) && textOf(byId("seeAllSort")) === "Sort by Most home Shortest commute Lowest monthly cost" && byId("seeAllSort-home").classList.contains("on")
      && /Ranked by the most home that fits your HomePilot comfort range, shortest commute first\./.test(textOf(byId("seeAllRule"))), textOf(byId("seeAllSort")));
  byId("seeAllSort-cost").click();
  const byCost15 = listCards(), restCost = restOf(cost15);
  check("(15l) 'Sort by: Lowest monthly cost' reorders See all by rankCities()'s cost order (each place's cheapest comfortable home)",
    byId("seeAllSort-cost").classList.contains("on") && !byId("seeAllSort-home").classList.contains("on") && byCost15.length === restCost.length && byCost15.every((c, i) => sameHome(c, restCost[i]))
      && byCost15.every((c, i) => i === 0 || byCost15[i - 1].monthly <= c.monthly),
    byCost15.map((c) => c.city + " " + c.monthly).join(", "));
  byId("seeAllSort-commute").click();
  const byDrive15 = listCards(), restDrive = restOf(commute15);
  check("(15m) 'Sort by: Shortest commute' likewise, shortest drive first",
    byDrive15.length === restDrive.length && byDrive15.every((c, i) => sameHome(c, restDrive[i])) && byDrive15.every((c, i) => i === 0 || byDrive15[i - 1].drive <= c.drive));
  check("(15n) ...and re-sorting leaves the answer cards as they were: the same cards, the open breakdown still open",
    byId("answers").querySelector(".city") === firstAnswer && !!openPanel15 && openPanel15.isConnected && openPanel15.style.display === "block"
      && answersOnPage().map((a) => a.key).join("|") === a15.map((a) => a.key).join("|"));
  // A card ticked for Compare under "See all places", then See all closed:
  // Compare still compares the home that card showed.
  const tickedRest = listCards()[0], tickedAnswer = a15[0];
  [tickedAnswer.id, tickedRest.id].forEach((id) => byId("cmp-chk-" + id).click());
  byId("seeAllBtn").click();
  check("(15o) closing it takes the rest away again, and shownCards is the answers only",
    !visible(byId("seeAllBody")) && byId("seeAllBtn").getAttribute("aria-expanded") === "false" && d.querySelectorAll("#list .city").length === 0
      && win.eval("shownCards.map(function(c){ return c.section; }).join()") === "answer-home,answer-commute,answer-cost");
  const cmpWritten = [];
  const openBefore = win.open;
  win.open = () => { const w = { html: "", document: { write(h) { w.html += h; }, close() {} }, focus() {}, print() {}, close() {} }; cmpWritten.push(w); return w; };
  win.eval("buildCompare()");
  win.open = openBefore;
  const cmp15 = cmpWritten[0] ? new win.DOMParser().parseFromString(cmpWritten[0].html, "text/html") : null;
  const cmp15Prices = cmp15 ? [...cmp15.querySelectorAll(".cmp-row")[0].querySelectorAll(".cmp-cell")].slice(1).map((e) => Number(e.textContent.replace(/[^0-9]/g, ""))) : [];
  check("(15o2) ...and a card ticked for Compare under See all still compares the home it showed, after See all is closed",
    cmp15Prices.join("|") === [tickedAnswer.price, tickedRest.price].join("|"), cmp15Prices.join("|") + " vs " + tickedAnswer.price + "|" + tickedRest.price);
  byId("cmp-chk-" + tickedAnswer.id).click();
  win.eval("initCompare()");
  const noteBtn = [...byId("rankNotes").querySelectorAll("button")].find((b) => /Show them/.test(b.textContent));
  if (noteBtn) noteBtn.click();
  check("(15p) 'Show them' on the note about far places opens 'See all places' at its 'Past your commute limit' section",
    !!noteBtn && seeAllOpenNow() && /Past your 60-minute commute limit/.test(byId("listMore").textContent) && moreCards(win).length > 0);
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
  check("(15q) a new search starts with 'See all places' closed again, in the most-home order",
    !visible(byId("seeAllBody")) && win.eval("seeAllOpen") === false && win.eval("resultsSort") === "home" && win.eval("showOverCommute") === false);

  // The home-type filter applies to the answers too.
  win.eval("filtProp('condo', document.getElementById('pt-condo'))");
  const condoAnswers = answersOnPage();
  check("(15r) with a home type picked, every answer is that type and still its question's winner",
    condoAnswers.length > 0 && condoAnswers.every((a) => a.type === "Condo") && sameHome(condoAnswers[0], engineRanked("home")[0])
      && condoAnswers.some((a) => a.answers.includes("cost") && sameHome(a, engineRanked("cost")[0])), condoAnswers.map((a) => a.label + " " + a.key).join("; "));
  win.eval("filtProp('all', document.getElementById('pt-all'))");

  // Two answers with the IDENTICAL home share one card, labelled with both,
  // and the free slot goes to "Also worth a look": the best most-home entry
  // not already shown. Found by search, so a price change can't hide it.
  let merged = null;
  for (const workCity of ["Toronto - West End", "King City", "Aurora", "Orangeville", "Acton"]) {
    search(win, { income: 150000, down: 100000, debt: 0, family: 3, firstTime: true, work: "daily", maxCommute: "60", workCity });
    const h = engineRanked("home"), c = engineRanked("commute"), k = engineRanked("cost");
    if (h[0] && c[0] && k[0] && h[0].key === c[0].key && k[0].key !== h[0].key && h.length >= 3) { merged = { workCity, h, c, k }; break; }
  }
  const mA = merged ? answersOnPage() : [];
  const shownKeys = mA.map((a) => a.key);
  const alsoExpected = merged ? merged.h.find((e) => e.key !== merged.h[0].key && e.key !== merged.k[0].key) : null;
  check("(15s) same home for 'Most home' and 'Shortest commute': one card labelled 'Most home · Shortest commute', then 'Lowest monthly cost'" + (merged ? " (work in " + merged.workCity + ")" : ""),
    !!merged && mA.length === 3 && mA[0].label === "Most home · Shortest commute" && sameHome(mA[0], merged.h[0]) && mA[1].label === "Lowest monthly cost" && sameHome(mA[1], merged.k[0]),
    merged ? mA.map((a) => a.label + " = " + a.key).join("; ") : "no merging buyer found");
  check("(15t) ...and the free slot is 'Also worth a look': the best most-home place not already shown; no home is shown twice",
    !!merged && mA[2].label === "Also worth a look" && sameHome(mA[2], alsoExpected) && new Set(shownKeys).size === shownKeys.length
      && win.eval("shownCards.map(function(c){ return c.section + ':' + c.answers.join('+'); }).join()") === "answer-home:home+commute,answer-cost:cost,answer-also:also",
    merged ? mA.map((a) => a.label + " = " + a.key).join("; ") + " / expected " + (alsoExpected && alsoExpected.key) : "");

  // Fewer comfortable places than cards: only what exists, no empty boxes.
  search(win, { income: 150000, down: 100000, debt: 0, family: 3, firstTime: true, work: "daily", maxCommute: "60", workCity: "Erin" });
  const few = answersOnPage(), fewRanked = engineRanked("home");
  check("(15u) fewer than three comfortable homes: only the cards there are, no empty box, and the grid is sized for them",
    few.length >= 1 && few.length < 3 && d.querySelectorAll("#answers .answer-slot").length === few.length
      && byId("answers").querySelector(".answer-grid").className === "answer-grid answer-grid-" + few.length
      && [...d.querySelectorAll("#answers .answer-slot")].every((s) => !!s.querySelector(".city")) && fewRanked.length <= few.length,
    few.map((a) => a.label + " = " + a.key).join("; ") + " / ranked " + fewRanked.length);
  check("(15v) ...a single home that wins all three questions carries all three labels",
    few.length !== 1 || few[0].label === "Most home · Shortest commute · Lowest monthly cost", few.map((a) => a.label).join("; "));

  // A remote buyer has no commute to answer: Most home, Lowest monthly cost,
  // and "Also worth a look", the runner-up for most home.
  search(win, { income: 200000, down: 150000, debt: 0, family: 3, firstTime: true, work: "remote" });
  const rA = answersOnPage(), rHome = engineRanked("home"), rCost = engineRanked("cost");
  check("(15w) remote: 'Most home', 'Lowest monthly cost', then 'Also worth a look' = the runner-up for most home; no commute answer",
    rA.length === 3 && rA.map((a) => a.label).join("|") === "Most home|Lowest monthly cost|Also worth a look" && sameHome(rA[0], rHome[0]) && sameHome(rA[1], rCost[0])
      && sameHome(rA[2], rHome.find((e, i) => i > 0 && e.key !== rCost[0].key)) && sameHome(rA[2], rHome[1]) && !/Shortest commute/.test(byId("answers").textContent),
    rA.map((a) => a.label + " = " + a.key).join("; ") + " / runner-up " + (rHome[1] && rHome[1].key));
  search(win, { ...COUPLE, work: "remote" });
  const rA2 = answersOnPage(), rHome2 = engineRanked("home"), rCost2 = engineRanked("cost");
  check("(15x) remote, and the most home is also the cheapest: one 'Most home · Lowest monthly cost' card, then the next two most-home places",
    rHome2[0] && rCost2[0] && rHome2[0].key === rCost2[0].key
      ? rA2.length === 3 && rA2[0].label === "Most home · Lowest monthly cost" && sameHome(rA2[0], rHome2[0]) && rA2.slice(1).every((a, i) => a.label === "Also worth a look" && sameHome(a, rHome2[i + 1]))
      : false,
    rA2.map((a) => a.label + " = " + a.key).join("; "));

  // Nothing comfortable: no answer cards. Since 2026-09-24 that is the
  // "you're close" page (IMPROVEMENT_PLAN.md 2.0), which section 16 checks.
  search(win, { ...COUPLE, work: "hybrid", maxCommute: "60" });
  check("(15y) nothing comfortable: no answer cards; the three closest options take their place (section 16)",
    answerCards(win).length === 0 && closestCards(win).length > 0 && d.querySelectorAll("#answers .answer-slot[data-answers='closest']").length === closestCards(win).length);

  // Phone and computer layout, from the stylesheet (jsdom does no layout).
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "calculator.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
  const baseAt = css.indexOf(".answer-grid{display:grid;grid-template-columns:minmax(0,1fr)");
  const threeAt = css.search(/@media\(min-width:1240px\)\{\s*\.answer-grid-3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[;}]/);
  const twoAt = css.search(/@media\(min-width:1024px\)\{\s*\.answer-grid\{align-items:start;row-gap:14px\}\s*\.answer-grid-2\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[;}]/);
  const outsideMedia = (at) => { const before = css.slice(0, at); return (before.match(/\{/g) || []).length === (before.match(/\}/g) || []).length; };
  search(win, { ...COUPLE, income: 180000, down: 120000, work: "hybrid", maxCommute: "60" });
  check("(15z) phone: the answer cards stack at full width, one column, as the first cards always did (the base rule, outside any media query)",
    baseAt !== -1 && outsideMedia(baseAt) && !/max-width[^{]*\{[^}]*answer-grid/.test(css));
  check("(15aa) computer: three answers side by side, a third of the width each (1240px+, about 223-241px a card up to 1280px), two a half each from 1024px; both after the phone rule, so they win",
    threeAt > baseAt && twoAt > baseAt && byId("answers").querySelector(".answer-grid").classList.contains("answer-grid-3") && d.querySelectorAll("#answers .answer-grid-3 > .answer-slot").length === 3);
  check("(15ab) 'See all places' is the listings page's outlined 'Load more' button, not a new design", /\.listings-load-more,\.see-all-btn\{/.test(css) && /\.listings-load-more:hover,\.see-all-btn:hover\{/.test(css)
    && byId("seeAllBtn").className === "see-all-btn");
  // Side by side, the labels share one row (a subgrid), so a two-question label
  // that wraps no longer pushes its card down, and it wraps at the dot, each
  // question on one line. tests/phone_length_test.js measures it in Chrome.
  check("(15ac) side by side the labels share one row, and each question in a label stays on one line",
    css.includes(".answer-grid-3 > .answer-slot{display:grid;grid-row:span 2;grid-template-rows:subgrid}") && css.includes(".answer-grid-2 > .answer-slot{display:grid;grid-row:span 2;grid-template-rows:subgrid}")
      && css.includes(".answer-q{white-space:nowrap}") &&[...d.querySelectorAll("#answers .answer-slot")].every((s) => s.querySelectorAll(".answer-label .answer-q").length === s.dataset.answers.split(" ").length && [...s.querySelectorAll(".answer-label .answer-q")].map(textOf).join(" · ") === textOf(s.querySelector(".answer-label"))));

  // =============== 16. HomePilot Worth Knowing and the "you're close" page (IMPROVEMENT_PLAN.md 2.2, 2.0) ===============
  // Every tip on the page is checked against the page itself: search again
  // with the one answer the tip changes, and the card it names must show the
  // price, monthly cost, % of take-home and label the tip quoted. The module's
  // own unit tests (tests/worth_knowing_test.js) check the rules in depth.
  const wkNow = () => JSON.parse(win.eval("JSON.stringify(worthKnowing(answerPicks(results,{maxCommute:maxCommuteMin,onlyType:activeProp!=='all'?activeProp:null}),activeProp!=='all'?activeProp:null))"));
  const wkTips = () => [...byId("worthKnowing").querySelectorAll(".wk-tip")].map((e) => ({ kind: e.dataset.kind, text: textOf(e) }));
  const WK_WORD = JSON.parse(win.eval("JSON.stringify(WK_TYPE)"));
  // An earn tip raises one income, the higher earner's (the buyer's when equal),
  // and says so; a buyer searching again types it into that box.
  const withChange = (b, kind, x) => kind === "save" ? { ...b, down: b.down + x }
    : b.partnerIncome && b.partnerIncome > b.income ? { ...b, partnerIncome: b.partnerIncome + x } : { ...b, income: b.income + x };
  // A card as the buyer reads it, and its row for one home type.
  const cardFor = (n, typeKey) => cardEls(win).map(readCard).find((c) => c.city === n && TYPE_KEY[c.type] === typeKey);
  const rowFor = (n, typeKey) => {
    const el = cardEls(win).find((e) => e.querySelector(".cn").textContent.trim() === n);
    const row = el && [...el.querySelectorAll("[id^='pt-row-']:not([id$='-chevron'])")].find((r) => r.id.endsWith("-" + typeKey));
    const m = row && /\$([\d,]+) · \$([\d,]+)\/mo/.exec(row.textContent);
    return m ? { price: Number(m[1].replace(/,/g, "")), monthly: Number(m[2].replace(/,/g, "")), pct: Number((/(\d+)%/.exec(row.textContent.replace(/\$[\d,]+/g, "")) || [])[1]) } : null;
  };
  // A save or earn tip: search again with it, and the card it names shows what it said.
  const checkLeverOnPage = (b, tip) => {
    const c = tip.claim;
    search(win, withChange(b, tip.kind, c.extra));
    const card = cardFor(c.n, c.type);
    const ok = !!card && card.price === c.price && card.monthly === c.monthly && pctOf(card) === c.pct && card.fit === c.fit && card.fit !== LBL[2];
    const detail = JSON.stringify(card && { city: card.city, type: card.type, price: card.price, monthly: card.monthly, pct: pctOf(card), fit: card.fit }) + " vs " + JSON.stringify(c);
    search(win, b);
    return [ok, detail];
  };

  // A normal page with two tips: a drive tip and an earn tip.
  const RICH = { income: 250000, down: 300000, debt: 0, family: 3, firstTime: false, work: "daily", workCity: "Toronto", maxCommute: "60" };
  search(win, RICH);
  const wkR = wkNow(), tipsR = wkTips(), boxR = byId("worthKnowing").querySelector(".wk-box");
  check("(16a) normal page: HomePilot Worth Knowing sits between the answer cards and 'See all places', in the 'At a glance' box style, with at most two tips",
    !!boxR && textOf(boxR.querySelector(".wk-title")) === "HomePilot Worth Knowing" && tipsR.length >= 1 && tipsR.length <= 2 && answerCards(win).length === 3
      && byId("answers").nextElementSibling === byId("worthKnowing") && byId("worthKnowing").nextElementSibling === byId("seeAll") && !wkR.empty,
    tipsR.map((x) => x.kind + ": " + x.text).join(" | "));
  const driveR = wkR.tips.find((x) => x.kind === "drive");
  if (driveR) {
    const c = driveR.claim, from = answerCards(win).find((a) => a.city === c.from.n && TYPE_KEY[a.type] === c.from.type), to = rowFor(c.n, c.type);
    const text = tipsR.find((x) => x.kind === "drive").text;
    const toCard = cardEls(win).map(readCard).find((x) => x.city === c.n);
    check("(16b) the drive tip's figures are the cards': the answer card it starts from, and the same home's row on the other place's card (price, monthly cost, drive)",
      !!from && !!to && to.price === c.price && to.monthly === c.monthly && from.price === c.from.price && from.monthly === c.from.monthly
        && text.includes(`Drive ${toCard.drive - from.drive} more minutes to ${c.n} (about ${toCard.drive} min each way)`)
        && text.includes(`${fcw(from.price - to.price)} less than in ${c.from.n} and ${fcw(from.monthly - to.monthly)} a month less`)
        && toCard.drive - from.drive <= 30 && (from.price - to.price >= 50000 || from.monthly - to.monthly >= 300),
      text + " / " + JSON.stringify({ from, to }));
  } else check("(16b) this buyer gets a drive tip (15 minutes to Pickering for the same semi, $105,000 less)", false, JSON.stringify(wkR.tips.map((x) => x.kind)));
  const leverR = wkR.tips.find((x) => x.kind === "earn" || x.kind === "save");
  if (leverR) {
    const [ok, detail] = checkLeverOnPage(RICH, leverR);
    check(`(16c) the ${leverR.kind} tip: searching again with ${fcw(leverR.claim.extra)} more, ${leverR.claim.n}'s card shows the bigger home at the tip's price, monthly cost, % and label`, ok, detail);
  } else check("(16c) this buyer gets a save or earn tip", false, JSON.stringify(wkR.tips.map((x) => x.kind)));

  // Savings are the limit: that tip first (14l checks its words).
  search(win, SAVER);
  check("(16d) savings the limit: its tip is the first HomePilot Worth Knowing tip, and there are at most two",
    wkTips()[0] && wkTips()[0].kind === "savings-limit" && wkTips().length <= 2);
  const saveS = wkNow().tips.find((x) => x.kind === "save");
  if (saveS) { const [ok, detail] = checkLeverOnPage(SAVER, saveS); check("(16e) ...and its save tip holds on the page: search with that much more down payment", ok, detail); }

  // The plan's worked example (2.0): $65K + $65K, $70K down, $450/mo debt,
  // hybrid, working in Toronto, first-time buyers; at the 60-minute default.
  const WORKED = { income: 65000, partnerIncome: 65000, down: 70000, debt: 450, family: 3, firstTime: true, work: "hybrid", workCity: "Toronto", maxCommute: "60" };
  search(win, WORKED);
  const wk60 = wkNow();
  const stretch60 = JSON.parse(win.eval("JSON.stringify(rankCities(results,{sort:'home',maxCommute:maxCommuteMin}).stretchOnly.map(function(e){ return {n:e.n,type:e.type,price:e.price,monthly:Math.round(e.costs.total),pct:e.pct}; }))"));
  const closest60 = closestCards(win);
  check("(16f) empty page: the heading is the count line: \"Nothing within 60 minutes fits your HomePilot comfort range yet, but you're close.\"",
    textOf(byId("cnt")) === "Nothing within 60 minutes fits your HomePilot comfort range yet, but you're close." && wk60.empty && wk60.close, textOf(byId("cnt")));
  // The label says what the card's own pill says: "Stretch" over a Stretch
  // pill, "Above your HomePilot comfort range" over a Good or Great one (a home
  // under 45% of take-home that is not comfortable only because of its price).
  const closestLabelOk = () => [...d.querySelectorAll("#answers .answer-slot")].every((s) => {
    const pill = textOf(s.querySelector(".fit-pill"));
    return s.dataset.answers === "closest" && textOf(s.querySelector(".answer-label")) === (pill === LBL[2] ? "Closest to fitting · Stretch" : "Closest to fitting · Above your HomePilot comfort range");
  });
  check("(16g) ...then the three closest options: the lowest % of take-home within the limit (rankCities()'s stretch-only list), each labelled 'Closest to fitting · Stretch', three across like the answers",
    closest60.length === 3 && closest60.every((c, i) => c.city === stretch60[i].n && TYPE_KEY[c.type] === stretch60[i].type && c.price === stretch60[i].price && c.monthly === stretch60[i].monthly && pctOf(c) === stretch60[i].pct)
      && closest60.every((c, i) => i === 0 || pctOf(closest60[i - 1]) <= pctOf(c)) && closest60.every((c) => c.drive <= 60)
      && closest60.every((c) => c.fit === LBL[2]) && closestLabelOk()
      && !!byId("answers").querySelector(".answer-grid.answer-grid-3") && answerCards(win).length === 0,
    closest60.map((c) => c.city + " " + pctOf(c) + "%").join(", "));
  check("(16g1) ...and 'Cities you can afford' is not above that heading (it is above a normal page's count)",
    !visible(byId("resTitle")) && (() => { search(win, RICH); const shown = visible(byId("resTitle")) && textOf(byId("resTitle")) === "Cities you can afford"; search(win, WORKED); return shown; })());
  // The buyer's own take-home above the estimate: the same three homes are
  // under 45% now, their pills say Good Fit, and the labels follow (they said
  // "Stretch" over every one, whatever the pill said).
  byId("takeHomeChange").click();
  byId("takeHomeInput").value = "9000";
  byId("takeHomeEdit").querySelector(".bp-apply-btn").click();
  const closestOwn = closestCards(win);
  check("(16g2) own take-home $9,000/mo: the closest cards' pills say Good Fit, and so do their labels: 'Closest to fitting · Above your HomePilot comfort range'",
    closestOwn.length > 0 && closestOwn.every((c) => c.fit !== LBL[2]) && closestLabelOk(),
    [...d.querySelectorAll("#answers .answer-slot")].map((s) => textOf(s.querySelector(".answer-label")) + " / " + textOf(s.querySelector(".fit-pill"))).join(" | "));
  byId("takeHomeReset").click();
  const stretchHtml = win.eval(`(function(){ var els = document.querySelectorAll('#answers .city'); return rankCities(results,{sort:'home',maxCommute:maxCommuteMin}).stretchOnly.slice(0,3).map(function(e,i){ return cityCardHtml(e,'stretch',els[i].id); }); })()`);
  const asEl = (h) => { const box = d.createElement("div"); box.innerHTML = h; return box.firstElementChild.outerHTML; };
  check("(16h) ...each is today's stretch card, unchanged: the same HTML cityCardHtml() draws under 'Only as a stretch' (the 'beyond comfortable' note, Stretch label, breakdowns, AI Insights, compare, View available homes)",
    [...d.querySelectorAll("#answers .city")].every((el, i) => el.outerHTML === asEl(stretchHtml[i])) && closest60.every((c) => /beyond comfortable/.test(c.text) && c.fit === LBL[2]));
  const tips60 = wkTips();
  check("(16i) ...then HomePilot Worth Knowing, the main message: one tip per lever that has one, in the order save, drive, earn",
    byId("answers").nextElementSibling === byId("worthKnowing") && !!byId("worthKnowing").querySelector(".wk-box") && tips60.length >= 1
      && tips60.map((x) => x.kind).join(",") === ["save", "drive", "earn"].filter((k) => tips60.some((x) => x.kind === k)).join(","),
    tips60.map((x) => x.kind + ": " + x.text).join(" | "));
  // One tip for each lever (plan 2.0), the drive one included at the 60-minute
  // default: the nearest place past the limit that fits, however far (it was
  // left out when that was more than 30 minutes past).
  const past60 = JSON.parse(win.eval("JSON.stringify(rankCities(results,{sort:'home',maxCommute:maxCommuteMin}).overCommute.filter(function(e){ return e.comfortable; }).map(function(e){ return {n:e.n,type:e.type,price:e.price,commuteMin:e.commuteMin}; }))"));
  const drive60 = wk60.tips.find((x) => x.kind === "drive");
  check("(16i2) ...a save, a drive and an earn tip at the 60-minute default; the drive tip is the nearest place past the limit that fits, with its minutes past the limit",
    tips60.map((x) => x.kind).join(",") === "save,drive,earn" && !!drive60 && past60.length > 0 && drive60.claim.n === past60[0].n && drive60.claim.price === past60[0].price
      && tips60.find((x) => x.kind === "drive").text.includes(`Drive ${past60[0].commuteMin - 60} minutes past your 60-minute limit and a ${WK_WORD[past60[0].type]} in ${past60[0].n}`),
    tips60.map((x) => x.text).join(" | "));
  for (const tip of wk60.tips.filter((x) => x.kind === "save" || x.kind === "earn")) {
    const [ok, detail] = checkLeverOnPage(WORKED, tip);
    const firstAfter = (() => { search(win, withChange(WORKED, tip.kind, tip.claim.extra)); const a = answerCards(win)[0]; search(win, WORKED); return a; })();
    check(`(16j) worked example, ${tip.kind} ${fcw(tip.claim.extra)}: searching again with it, ${tip.claim.n}'s ${tip.claim.type} fits at the tip's figures and is the 'Most home' answer`,
      ok && !!firstAfter && firstAfter.city === tip.claim.n && TYPE_KEY[firstAfter.type] === tip.claim.type, detail);
    check(`(16k) worked example, ${tip.kind}: "just fits" exactly when the % lands at 43% or more (within 2 points of the 45% Stretch line)`,
      /just fits/.test(tips60.find((x) => x.kind === tip.kind).text) === (tip.claim.pct >= 43));
  }
  const nMore = stretch60.length - 3;
  check("(16l) 'See all places' is closed, with the other stretch-only places behind it",
    visible(byId("seeAllBtn")) && textOf(byId("seeAllBtn")) === `See all places (${nMore} more)` && !visible(byId("seeAllBody"))
      && textOf(byId("rankNotes")).includes(`${stretch60.length} cities work only as a stretch — the closest 3 are below, the rest under "See all places".`),
    textOf(byId("seeAllBtn")) + " / " + textOf(byId("rankNotes")));
  byId("seeAllBtn").click();
  const rest60 = [...d.querySelectorAll("#listMore .city")].map(readCard);
  check("(16m) ...opening it shows 'Only as a stretch' with the rest, none of the three again; shownCards is the three closest, then those",
    /Only as a stretch/.test(byId("listMore").textContent) && rest60.length === nMore && rest60.every((c) => !closest60.some((x) => x.city === c.city && x.type === c.type))
      && d.querySelectorAll("#list .city").length === 0
      && win.eval("shownCards.map(function(c){ return c.section; }).join()") === ["answer-closest", "answer-closest", "answer-closest"].concat(Array(nMore).fill("stretch")).join(),
    win.eval("shownCards.map(function(c){ return c.section; }).join()"));
  const showBtn = [...byId("rankNotes").querySelectorAll("button")].find((x) => /Show them/.test(x.textContent));
  if (showBtn) showBtn.click();
  check("(16n) ...and 'Show them' still brings in the places past the limit, in their own section", !!showBtn && /Past your 60-minute commute limit/.test(byId("listMore").textContent));
  // The brand (plan 2.2): the results text around the cards never says
  // "comfortably afford" or a bare "comfort range". The cards themselves are
  // today's cards, unchanged.
  const unbranded = (x) => /comfortably afford/.test(x) || (x.match(/comfort range/g) || []).length !== (x.match(/HomePilot comfort range/g) || []).length;
  const resultsText = () => [textOf(byId("resTitle")), textOf(byId("cnt")), textOf(byId("rankNotes")), textOf(byId("worthKnowing")), textOf(byId("seeAllRule")),
    ...[...d.querySelectorAll("#answers .answer-label, #listMore .more-section > .sec-title, #listMore .more-section > .count")].map(textOf)];
  check("(16o) the old empty-page message and its hint are gone; the new pieces never say 'comfortably afford' or a bare 'comfort range'",
    !/the closest options are below|Try adjusting your filters/.test(d.body.textContent) && !resultsText().some(unbranded), resultsText().filter(unbranded).join(" | "));
  // ...and a normal page: the count, the notes (places past the limit, stretch
  // only), the rule sentence under "Sort by", and the two sections inside "See
  // all places". Until 2026-09-24 these said "you can comfortably afford" and
  // "above your comfort range". $140K, $100K down, $450 debt, hybrid: one place
  // fits, nine only as a stretch, and 23 past the limit fit.
  search(win, { ...COUPLE, income: 140000, down: 100000, work: "hybrid", maxCommute: "60" });
  openSeeAll(win);
  if (!win.eval("showOverCommute")) win.eval("toggleOverCommute()");
  const normalText = resultsText();
  check("(16o2) ...nor on a normal page with 'See all places' open: count, notes, rule sentence, 'Only as a stretch' and 'Past your commute limit'",
    !normalText.some(unbranded) && /that fits your HomePilot comfort range/.test(textOf(byId("cnt"))) && /that fits your HomePilot comfort range\)/.test(textOf(byId("rankNotes")))
      && d.querySelectorAll("#listMore .more-section").length === 2 && /above your HomePilot comfort range/.test(textOf(byId("listMore"))),
    normalText.filter(unbranded).join(" | ") + " // " + textOf(byId("cnt")) + " // " + textOf(byId("rankNotes")));
  win.eval("toggleOverCommute()");

  // The same couple with the 90-minute limit the plan used: a drive tip too.
  search(win, { ...WORKED, maxCommute: "90" });
  const wk90 = wkNow(), drive90 = wk90.tips.find((x) => x.kind === "drive");
  check("(16p) worked example at 90 minutes: \"Nothing within 90 minutes ... but you're close.\", with a save, a drive and an earn tip",
    textOf(byId("cnt")) === "Nothing within 90 minutes fits your HomePilot comfort range yet, but you're close." && wkTips().map((x) => x.kind).join(",") === "save,drive,earn",
    wkTips().map((x) => x.text).join(" | "));
  if (drive90) {
    const c = drive90.claim;
    search(win, { ...WORKED, maxCommute: "none" });
    const card = cardFor(c.n, c.type);
    check(`(16q) ...the drive tip holds: with no limit, ${c.n}'s card shows the ${c.type} at the tip's price, % and label, ${c.extra} minutes past 90`,
      !!card && card.price === c.price && pctOf(card) === c.pct && card.fit === c.fit && card.drive === c.commuteMin && c.commuteMin - 90 === c.extra && c.extra <= 30,
      JSON.stringify(card && { price: card.price, pct: pctOf(card), drive: card.drive }) + " vs " + JSON.stringify(c));
  }

  // Not close: no tip gets there within the caps. The heading stops at "yet."
  // and the box says plainly what would change the answer.
  search(win, { income: 90000, down: 80000, debt: 0, family: 3, firstTime: true, work: "daily", workCity: "Toronto", maxCommute: "60" });
  const far = wkNow();
  check("(16r) not close: \"Nothing within 60 minutes fits your HomePilot comfort range yet.\" (no 'close'), and the box says what would change the answer",
    far.empty && !far.close && textOf(byId("cnt")) === "Nothing within 60 minutes fits your HomePilot comfort range yet." && /What would change the answer/.test(textOf(byId("worthKnowing")))
      && far.far.length > 0 && wkTips().length === far.far.length + far.tips.length, textOf(byId("cnt")) + " / " + textOf(byId("worthKnowing")));
  search(win, { income: 70000, down: 15000, debt: 0, family: 3, firstTime: true, work: "daily", workCity: "Toronto", maxCommute: "60" });
  // Savings cap this buyer's bank figure but not their HomePilot comfort range,
  // so there is no savings tip: it said "about $500 more saved would get you
  // there" (the bank's ceiling) right above "not $250,000 more saved" until
  // 2026-09-24.
  const c16s = win.eval("lastSearch.calc");
  check("(16s) nothing at all within reach: the box says no single change it tried gets there, and has no savings tip, since savings cap only the bank's figure",
    textOf(byId("cnt")) === "Nothing within 60 minutes fits your HomePilot comfort range yet." && /No single change we tried/.test(textOf(byId("worthKnowing")))
      && c16s.downPaymentLimited && !c16s.comfortDownPaymentLimited && !wkTips().some((x) => x.kind === "savings-limit") && !/more saved would get you there/.test(textOf(byId("worthKnowing")))
      && d.querySelectorAll("#answers .city").length === 0, JSON.stringify(c16s) + " " + textOf(byId("worthKnowing")));

  // Remote buyers: no commute, so no "within N minutes" and never a drive tip.
  search(win, { income: 90000, down: 40000, debt: 0, family: 3, firstTime: true, work: "remote" });
  check("(16t) remote, nothing fits yet: \"Nothing fits your HomePilot comfort range yet, but you're close.\", and no drive tip",
    textOf(byId("cnt")) === "Nothing fits your HomePilot comfort range yet, but you're close." && !wkTips().some((x) => x.kind === "drive") && wkTips().length > 0, textOf(byId("cnt")));
  search(win, { income: 140000, down: 80000, debt: 0, family: 3, firstTime: true, work: "remote" });
  check("(16u) remote, normal page: tips, but never a drive tip", wkTips().length > 0 && !wkTips().some((x) => x.kind === "drive") && !wkNow().levers.some((x) => x.kind === "drive"));

  // A home type picked: the heading names it.
  search(win, WORKED);
  win.eval("filtProp('detached', document.getElementById('pt-detached'))");
  check("(16v) with a home type picked, the heading names it: \"No detached home within 60 minutes fits your HomePilot comfort range yet...\"",
    /^No detached home within 60 minutes fits your HomePilot comfort range yet/.test(textOf(byId("cnt"))), textOf(byId("cnt")));
  win.eval("filtProp('all', document.getElementById('pt-all'))");

  // The box is the "At a glance" box's style, as classes: same colours, border, radius, heading and lines.
  const glanceSrc = win.eval("buildWhyRanked.toString()");
  check("(16w) the box reuses today's info-box style: the 'At a glance' panel's background, border, radius, heading and line styles",
    /\.wk-box\{margin:4px 0 0;padding:10px 12px;background:#FAFAFA;border:1px solid #EEEEEE;border-radius:10px\}/.test(css) && /padding:10px 12px;background:#FAFAFA;border:1px solid #EEEEEE;border-radius:10px/.test(glanceSrc)
      && /\.wk-title\{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0\.06em;color:#555;margin-bottom:7px\}/.test(css) && /font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0\.06em;color:#555;margin-bottom:7px/.test(glanceSrc)
      && /\.wk-tip\{font-size:12px;color:#1a1a1a;padding:2px 0;display:flex;align-items:flex-start;gap:6px\}/.test(css) && /font-size:12px;color:#1a1a1a;padding:2px 0;display:flex;align-items:flex-start;gap:6px/.test(glanceSrc));

  check("(8) no uncaught script errors during any of this", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
