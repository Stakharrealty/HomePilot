// homepage-example.js — the homepage's example results, from the real engine.
//
// Added 2026-09-23 (IMPROVEMENT_PLAN.md 1.3, REVIEW_BACKLOG.md P0-4). The
// example panel used to be typed by hand: Barrie detached at $681K (the
// engine's own price table says $800K), Milton at $845K ($1,075,000), and four
// rows no single buyer's numbers could produce, labelled "ranked for your
// budget" when they were nobody's. It now runs the calculator's own ranking,
// rankCities() in ranking.js, for one stated sample buyer (the label above the
// panel says who), so it always shows exactly what the calculator would show
// that buyer and cannot drift from the engine again.
//
// Loaded last on index.html, which already loads every engine script. It sets
// the calculator's globals for the sample buyer, ranks, and puts every one of
// them back.
//
// Two earners since 2026-09-24 (IMPROVEMENT_PLAN.md 2.4c): $90K + $60K, as a
// couple would fill in the calculator's "Your income" and "Partner's income"
// boxes. Buying power uses the two added together, as a lender does. Take-home
// is taxed person by person by estimateHouseholdNetAnnual() in utils.js, the
// function the calculator's go() uses (plan 3.3). The line above the panel
// (heroExampleBuyer in index.html) states both incomes, and
// tests/homepage_claims_test.js checks that line against this object and the
// rows against the calculator page itself.

const HOMEPAGE_EXAMPLE_BUYER = {
  income: 90000, partnerIncome: 60000, down: 100000, debt: 0, family: "3", firstTimeBuyer: true,
  work: "hybrid", workZone: "toronto_downtown", // works in Toronto, 2-4 days a week
};

// The sample buyer's top `count` places, as rankCities() entries.
function homepageExampleRows(buyer, count) {
  const saved = { fam_selected, dn_selected, grossMonthlyIncome, netMonthlyIncome, existingDebt, firstTimeBuyer,
    customMortgageRate, workArrangement, workZone, buyPower, comfortBuyPower };
  try {
    const partner = buyer.partnerIncome || 0, total = buyer.income + partner;
    fam_selected = buyer.family; dn_selected = buyer.down; existingDebt = buyer.debt;
    grossMonthlyIncome = total / 12; netMonthlyIncome = estimateHouseholdNetAnnual(buyer.income, partner) / 12;
    firstTimeBuyer = buyer.firstTimeBuyer === true; customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT / 100;
    workArrangement = buyer.work; workZone = buyer.workZone;
    const b = calcBP(total, buyer.down, buyer.debt);
    buyPower = b.bp; comfortBuyPower = b.comfortBP;
    return rankCities(candidateCities("all", b.bp), { sort: "home", maxCommute: DEFAULT_MAX_COMMUTE[buyer.work] || null })
      .ranked.slice(0, count);
  } finally {
    ({ fam_selected, dn_selected, grossMonthlyIncome, netMonthlyIncome, existingDebt, firstTimeBuyer,
      customMortgageRate, workArrangement, workZone, buyPower, comfortBuyPower } = saved);
  }
}

function renderHomepageExample() {
  const list = document.getElementById("heroExampleList");
  if (!list) return;
  let rows = [];
  try { rows = homepageExampleRows(HOMEPAGE_EXAMPLE_BUYER, 4); } catch (e) { rows = []; }
  const COLOURS = { fg: ["#E1F5EE", "#085041", "#1D9E75"], fo: ["#E6F1FB", "#0C447C", "#2F80C4"], fs: ["#FAEEDA", "#633806", "#C7841A"] };
  const K = (n) => "$" + Math.round(n / 1000) + "K";
  list.innerHTML = rows.map((e, i) => {
    const [bg, fg, bar] = COLOURS[e.fit.cls] || COLOURS.fo;
    const drive = e.commuteMin !== null ? " · about " + e.commuteMin + " min drive" : "";
    return '<div class="lb-row"><span class="lb-rank">' + (i + 1) + '</span><div class="lb-body">' +
      '<div class="lb-top"><span class="lb-city">' + e.n + '</span><span class="lb-badge" style="background:' + bg + ';color:' + fg + '">' + e.fit.lbl + '</span></div>' +
      '<p class="lb-meta">' + (PROP_LABELS[e.type] || e.type) + ' · ' + K(e.price) + ' · ' + fc(e.costs.total) + '/mo · ' + e.pct + '% of take-home' + drive + '</p>' +
      '<div class="lb-bar" role="img" aria-label="' + e.pct + '% of take-home pay"><div class="lb-bar-fill" style="width:' + Math.min(100, e.pct) + '%;background:' + bar + '"></div></div>' +
      '</div></div>';
  }).join("");
}

renderHomepageExample();
