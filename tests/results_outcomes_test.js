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
  d.getElementById("inc2").value = b.partnerIncome ? String(b.partnerIncome) : ""; // 2026-09-23: two incomes
  d.getElementById("dwn").value = String(b.down);
  d.getElementById("dbt").value = String(b.debt || 0);
  d.getElementById("fam").value = String(b.family || 3);
  d.getElementById("area").value = "all";
  win.eval(`setFTB(${b.firstTime === true})`);
  // 2026-09-23 (IMPROVEMENT_PLAN.md 1.7): the rebate box and residency.
  const box = d.getElementById("lttRebate");
  if (box) { box.checked = b.neverOwnedAnywhere === true; win.eval(`setLttRebateConfirmed(${b.neverOwnedAnywhere === true})`); }
  win.eval(`setResident(${b.resident !== false})`);
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
  search(win, { ...TOR, firstTime: true, neverOwnedAnywhere: false });
  check("(9a) the rebate box appears only for a first-time buyer, unticked", win.document.getElementById("ltt_rebate_row").style.display === "flex" && !win.document.getElementById("lttRebate").checked);
  const torType = win.eval("PT['Toronto - Scarborough'].condo") ? "condo" : "town";
  const newcomer = breakdown("Toronto - Scarborough", torType);
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
  search(win, { ...TOR, firstTime: false });
  check("(9g) not a first-time buyer: the rebate box is hidden and unticked", win.document.getElementById("ltt_rebate_row").style.display === "none" && win.eval("lttRebateConfirmed") === false);

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
  // This couple has no comfortable place within 90 minutes even on two
  // incomes, so their cards are the stretch ones; those show % of take-home too.
  const pairCards = [...mainCards(win), ...moreCards(win)];
  check("(11c) each card's % of take-home is worked out on the two-earner take-home",
    pairCards.length > 0 && pairCards.every((c) => { const m = /(\d+)% of take-home/.exec(c.text); return !!m && Math.abs(Number(m[1]) - (c.monthly / pairNet) * 100) <= 1; }),
    pairCards.slice(0, 3).map((c) => c.city + " " + c.monthly + " " + (/(\d+)% of take-home/.exec(c.text) || [])[1] + "%").join("; "));
  check("(11d) the summary shows both incomes", /household income \$130,000\/yr \(\$65,000 \+ \$65,000\)/.test(win.document.getElementById("bpSub").textContent),
    (/Based on[^·]*/.exec(win.document.getElementById("bpSub").textContent) || [""])[0]);
  win.eval("saveBuyerProfile()");
  const pairProfile = JSON.parse(win.sessionStorage.getItem("hp_buyer_profile_v1"));
  check("(11f) the listing pages get the two-earner take-home", Math.abs(pairProfile.netMonthlyIncome - pairNet) < 0.01);
  sentBody = null;
  win.document.getElementById("nm").value = "Test Buyer";
  win.document.getElementById("em").value = "test@example.com";
  win.document.getElementById("done").style.display = "none";
  win.document.getElementById("subBtn").disabled = false;
  await win.eval("sub()");
  check("(11g) the lead carries the household total and each income",
    !!sentBody && sentBody.income === 130000 && sentBody.applicantIncome === 65000 && sentBody.partnerIncome === 65000,
    JSON.stringify(sentBody && { income: sentBody.income, applicantIncome: sentBody.applicantIncome, partnerIncome: sentBody.partnerIncome }));
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
  win.eval("setLang('fr')");
  const frLabel = win.document.getElementById("l1b").textContent, frPh = win.document.getElementById("inc2").placeholder;
  win.eval("setLang('en')");
  check("(11j) the partner box is translated", frLabel === win.eval("T.fr.l1b") && frPh === win.eval("T.fr.inc2_ph") && win.document.getElementById("l1b").textContent === "Partner's income (before tax)", frLabel + " | " + frPh);

  check("(8) no uncaught script errors during any of this", errors.length === 0, errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
