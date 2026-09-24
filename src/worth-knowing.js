// worth-knowing.js — HomePilot Worth Knowing, and the "you're close" empty page
//
// Added 2026-09-24 (IMPROVEMENT_PLAN.md 2.2 "Worth Knowing" and 2.0 "No more
// empty page"). Loaded via <script src="src/worth-knowing.js"></script> on
// calculator.html, after render.js, same shared global scope. render() calls
// worthKnowing() and draws what it returns.
//
// HomePilot Worth Knowing is one or two trade-offs for this buyer, worked out
// from the app's own prices, monthly costs, drive times and calcBP(). No AI and
// no network: every tip is the calculator's own engine run again with one
// input changed, never an estimate of what that run would say.
//   - Savings are the limit: calcBP()'s "about $X more saved would get you
//     there", there being the HomePilot comfort range the buyer's income alone
//     would give (savingsLimitTip(), main.js). It used to sit in the top
//     section; it is the first tip whenever it applies.
//   - Save more: the smallest extra down payment, in $5,000 steps, that makes
//     a better home comfortable -- a bigger home type in one of the answer
//     places, or on the empty page the first place that fits at all.
//   - Drive further: the same (or a bigger) home type for a big saving and a
//     short extra drive. On the empty page: the nearest place past the
//     buyer's commute limit that fits. No drive tip without a commute (remote
//     work, or a work location the app could not place).
//   - Earn more: the smallest extra income a year, in $5,000 steps, that does
//     what "save more" does. With two incomes it goes to the higher earner and
//     the tip says so (wkEarnTo()). None while the buyer's own take-home is in
//     force (wkOwnTakeHome()).
// A tip shows only when it is worth it (the WK_ constants below). Weak tips
// stay hidden. The normal page shows at most two, strongest first; the empty
// page one per lever that has one.
//
// The empty page (2.0), when no place within the commute limit fits the
// HomePilot comfort range: "Nothing within 60 minutes fits your HomePilot
// comfort range yet, but you're close." -- "you're close" only when a save,
// drive or earn tip gets there within the caps below; otherwise the heading
// stops at "yet." and HomePilot Worth Knowing says plainly what would change
// the answer. Then the three closest options (lowest % of take-home within the
// limit), labelled Stretch (or above the HomePilot comfort range), in today's
// cards; then HomePilot Worth Knowing.
// render() draws the cards and the heading (render.js); this file decides
// what they say.
//
// "Fits" means exactly what it means on the cards: comfortable by
// isComfortable() (ranking.js) -- inside the HomePilot comfort range and not
// labelled Stretch.
//
// Since 2026-09-24 (2.2b) it also works out the "Also worth a look" answer
// card (wkAlso()): what it takes to get more home, when the answers leave a
// card free.
//
// Contains: the WK_ thresholds, wkBase(), wkRun() (the engine, run again with
// one input changed), wkAlso(), worthKnowing() (the tips and the "Also worth a
// look" card, cached per search and setting), wkEmptyHeading(),
// worthKnowingHtml().

// ── What makes a tip worth showing ─────────────────────────────────────────
const WK_STEP = 5000;               // save more and earn more go up in $5,000 steps
const WK_SAVE_CAP = 50000;          // a save tip asks for at most $50,000 more down payment
const WK_EARN_CAP = 25000;          // an earn tip asks for at most $25,000 more household income a year
const WK_DRIVE_CAP_MIN = 30;        // a drive tip asks for at most 30 more minutes each way
                                    // (on the empty page: "you're close" needs a place at most 30 past
                                    // the buyer's limit; the drive tip itself shows at any distance)
const WK_DRIVE_MIN_SAVING = 50000;  // ...and, on the normal page, saves at least $50,000 on the price
const WK_DRIVE_MIN_MONTHLY = 300;   // ...or at least $300 a month
const WK_STRETCH_LINE_PCT = 45;     // getFit(): 45% of take-home or more is Stretch
const WK_JUST_FITS_PTS = 2;         // within 2 points under that line, a home "just fits"
const WK_MAX_TIPS = 2;              // the normal page shows at most two tips
// The empty page, when nothing is within the caps above: how far the engine
// looks to say what WOULD change the answer. Past these it says so plainly.
const WK_FAR_SAVE_CAP = 250000;
const WK_FAR_EARN_CAP = 100000;

// Home types in a sentence: "a condo in Whitby", "same detached home"
// (HOME_TYPE_WORDS, ranking.js).
const WK_TYPE = HOME_TYPE_WORDS;
// Strongest first; on a tie, save, then drive, then earn.
const WK_LEVER_ORDER = { save: 0, drive: 1, earn: 2 };

// The buyer as last searched (main.js's lastSearch), with the settings on
// screen now: the commute limit and the home-type filter. null before a search.
function wkBase(onlyType) {
  const s = typeof lastSearch !== 'undefined' ? lastSearch : null;
  if (!s || !s.calc) return null;
  return {
    total: s.total, own: s.own || 0, partner: s.partner || 0, dn: s.dn, dbt: s.dbt, area: s.area || 'all',
    rate: Number.isFinite(s.rate) ? s.rate : customMortgageRate,
    limit: maxCommuteMin, onlyType: onlyType || null,
  };
}

// Whose income an "earn more" tip raises (2026-09-24). Take-home is taxed
// person by person, so the same household raise gives a different take-home
// depending on who earns it, and the tip's place, price and % hold only for
// the split it was worked out on. It used to split the raise in the couple's
// current proportion ($7,143 + $2,857 of $10,000), which the tip never stated
// and no buyer would type. Now the whole raise goes to one person, the higher
// earner (the buyer, when the two are equal), and the tip says so: exactly
// what the buyer would type into that box to search again.
function wkEarnTo(base) { return base.partner > base.own ? 'partner' : 'own'; }

// The engine, run again for the buyer with one input changed:
//   { extraDown }   -- more down payment;
//   { extraIncome } -- more income a year for the higher earner (wkEarnTo());
//                      take-home is the estimate for the new pair of incomes,
//                      exactly as go() works it out when the buyer searches
//                      with them (householdNetAnnual() on the new split). A
//                      buyer's own take-home figure is not carried over: go()
//                      drops it when an income changes, so worthKnowing() offers
//                      no earn tip while one is in force;
//   { maxCommute }  -- a different commute limit (null for none).
// It is go()'s own calculation, through searchAgain() (main.js): calcBP() on
// the changed figures, at the rate the
// search used (go() always searches at the market rate; the rate slider then
// changes monthly costs, not buying power), candidateCities() for the same
// area, then rankCities() with the same commute limit and home-type filter as
// the page, at the rate on screen. The page's globals are put back afterwards,
// whatever happens. With no change it gives exactly the page's own ranking
// (tests/worth_knowing_test.js checks that).
// Returns { calc, ranking, total, dn }.
function wkRun(base, change) {
  const c = change || {};
  const extraIncome = c.extraIncome || 0, extraDown = c.extraDown || 0;
  const total = base.total + extraIncome, dn = base.dn + extraDown;
  const limit = Object.prototype.hasOwnProperty.call(c, 'maxCommute') ? c.maxCommute : base.limit;
  let net = netMonthlyIncome;
  if (extraIncome) {
    // householdNetAnnual() on the new split, as go() computes it.
    const savedShare = partnerIncomeShare;
    try {
      const partner = base.partner + (wkEarnTo(base) === 'partner' ? extraIncome : 0);
      partnerIncomeShare = total > 0 ? partner / total : 0;
      net = householdNetAnnual(total) / 12;
    } finally { partnerIncomeShare = savedShare; }
  }
  const r = searchAgain({ total, dn, dbt: base.dbt, area: base.area, rate: base.rate, net, wa: workArrangement, zone: workZone,
    limit, onlyType: base.onlyType, sorts: ['home'] });
  return { calc: r.calc, ranking: r.rankings.home, total, dn };
}

// ── Wording ────────────────────────────────────────────────────────────────
function wkHome(e) { return 'a ' + WK_TYPE[e.type] + ' in ' + e.n; }
// "Just fits" when the % of take-home lands within WK_JUST_FITS_PTS of the
// Stretch line. It is the % the cards show (rankCities()'s pct).
function wkJustFits(pct) { return Number.isFinite(pct) && pct >= WK_STRETCH_LINE_PCT - WK_JUST_FITS_PTS; }
// A home that fits can round to 45% (44.9%), the figure a Stretch card next to
// it shows for 45.2%. The tip then says "just under 45%" (2026-09-24), so the
// home it says fits does not read as the Stretch card's figure.
function wkPctWords(e) {
  return (e.pct >= WK_STRETCH_LINE_PCT && e.fit.cls !== 'fs' ? 'just under ' + WK_STRETCH_LINE_PCT : e.pct) + '% of take-home';
}
function wkFits(e) {
  return wkJustFits(e.pct)
    ? 'just fits your HomePilot comfort range: ' + fc(e.price) + ' at ' + wkPctWords(e) + ', close to the Stretch line'
    : 'fits your HomePilot comfort range: ' + fc(e.price) + ', a ' + e.fit.lbl + ' at ' + wkPctWords(e);
}
// A rankCities() entry as a tip's claim: what the tip says, for the tests to
// check against a fresh run of the engine.
function wkClaimOf(e) {
  return { n: e.n, type: e.type, price: e.price, monthly: Math.round(e.costs.total), pct: e.pct, fit: e.fit.lbl, commuteMin: e.commuteMin, justFits: wkJustFits(e.pct) };
}
// An earn tip says whose income it raises when there are two (wkEarnTo()), in
// the form's own words ("Your income", "Partner's income").
function wkLeverHtml(lever, amount, base) {
  if (lever === 'save') return 'Save <b>' + fc(amount) + ' more</b> and ';
  const whose = !base || !(base.partner > 0) ? '' : wkEarnTo(base) === 'partner' ? ", added to your partner's income" : ', added to your income';
  return 'Earn <b>' + fc(amount) + ' more a year</b> (before tax' + whose + ') and ';
}

// ── The levers ─────────────────────────────────────────────────────────────
// The first step, WK_STEP apart from `from` to `to`, at which `hit(run)` finds
// something. "Smallest" is by construction: every step below it was run and
// found nothing.
function wkFirstStep(base, lever, from, to, hit) {
  const key = lever === 'save' ? 'extraDown' : 'extraIncome';
  for (let x = from; x <= to; x += WK_STEP) {
    const run = wkRun(base, { [key]: x });
    const h = hit(run);
    if (h) return { x, run, h };
  }
  return null;
}

// Normal page, save or earn: a bigger home type becomes comfortable in one of
// the answer places. `places` is each answer place with the most home it has
// today (the page's own "most home" entry for it). On one step, the biggest
// jump wins, then the lower % of take-home, then the answer order.
function wkUpgradeTip(base, lever, places, cap) {
  const found = wkFirstStep(base, lever, WK_STEP, cap, (run) => {
    let best = null;
    places.forEach((p, i) => {
      const e = run.ranking.ranked.find((x) => x.n === p.n);
      if (!e || !(HOME_RANK[e.type] > HOME_RANK[p.type])) return;
      if (!best || HOME_RANK[e.type] > HOME_RANK[best.e.type] || (HOME_RANK[e.type] === HOME_RANK[best.e.type] && e.pct < best.e.pct)) best = { e, from: p, i };
    });
    return best;
  });
  if (!found) return null;
  const e = found.h.e;
  return {
    kind: lever, extra: found.x, effort: found.x / cap,
    claim: Object.assign(wkClaimOf(e), { lever, extra: found.x, fromType: found.h.from.type }, lever === 'earn' ? { to: wkEarnTo(base) } : {}),
    html: wkLeverHtml(lever, found.x, base) + wkHome(e) + ' ' + wkFits(e) + '.',
  };
}

// Normal page, drive: from one of the answer cards, a place further out (but
// within the buyer's limit) with the same or a bigger home type, comfortable,
// that is cheaper by at least WK_DRIVE_MIN_SAVING or WK_DRIVE_MIN_MONTHLY a
// month, for at most WK_DRIVE_CAP_MIN more minutes each way. Its strength is
// the share of the 30 minutes it asks for, divided by how many times over the
// minimum saving it pays back; the strongest wins.
function wkDriveTip(answers, onlyType) {
  const byHome = answers.byHome;
  if (!byHome.commuteKnown) return null;
  const types = onlyType ? [onlyType] : HOME_ORDER;
  let best = null;
  answers.picks.forEach((p) => {
    const ref = p.entry;
    if (!Number.isFinite(ref.commuteMin)) return;
    byHome.ranked.forEach((cand) => {
      if (cand.n === ref.n || !Number.isFinite(cand.commuteMin)) return;
      const extra = cand.commuteMin - ref.commuteMin;
      if (extra <= 0 || extra > WK_DRIVE_CAP_MIN) return;
      types.forEach((t) => {
        if (HOME_RANK[t] < HOME_RANK[ref.type]) return;
        const o = qualifyingOption(cand.city, t);
        if (!isComfortable(o)) return;
        const saving = ref.price - o.price, monthly = Math.round(ref.costs.total - o.costs.total);
        if (!(saving > 0 && monthly > 0)) return;
        if (saving < WK_DRIVE_MIN_SAVING && monthly < WK_DRIVE_MIN_MONTHLY) return;
        const effort = (extra / WK_DRIVE_CAP_MIN) / Math.max(saving / WK_DRIVE_MIN_SAVING, monthly / WK_DRIVE_MIN_MONTHLY);
        if (!best || effort < best.effort || (effort === best.effort && HOME_RANK[t] > HOME_RANK[best.o.type])) best = { effort, ref, cand, o, extra, saving, monthly };
      });
    });
  });
  if (!best) return null;
  const { ref, cand, o, extra, saving, monthly } = best;
  const what = o.type === ref.type ? 'same ' + WK_TYPE[o.type] : 'a ' + WK_TYPE[o.type] + ' instead of a ' + WK_TYPE[ref.type];
  return {
    kind: 'drive', extra, effort: best.effort,
    claim: { lever: 'drive', extra, n: cand.n, type: o.type, price: o.price, monthly: Math.round(o.costs.total), commuteMin: cand.commuteMin,
      from: { n: ref.n, type: ref.type, price: ref.price, monthly: Math.round(ref.costs.total), commuteMin: ref.commuteMin }, saving, monthlySaving: monthly },
    html: 'Drive <b>' + extra + ' more minutes</b> to ' + cand.n + ' (about ' + cand.commuteMin + ' min each way): ' + what + ', ' +
      fc(saving) + ' less than in ' + ref.n + ' and ' + fc(monthly) + ' a month less.',
  };
}

// Empty page, save or earn: the smallest step at which any place within the
// limit fits. It names the one the page would then show first (rankCities()'s
// "most home" #1), and how many others would fit too.
function wkFirstFitTip(base, lever, from, to) {
  const found = wkFirstStep(base, lever, from, to, (run) => run.ranking.ranked[0] || null);
  if (!found) return null;
  const e = found.h, others = found.run.ranking.ranked.length - 1;
  const cap = lever === 'save' ? WK_SAVE_CAP : WK_EARN_CAP;
  return {
    kind: lever, extra: found.x, effort: found.x / cap,
    claim: Object.assign(wkClaimOf(e), { lever, extra: found.x, places: others + 1 }, lever === 'earn' ? { to: wkEarnTo(base) } : {}),
    html: wkLeverHtml(lever, found.x, base) + wkHome(e) + ' ' + wkFits(e) + '.' +
      (others > 0 ? ' ' + others + ' other place' + (others === 1 ? '' : 's') + ' would fit too.' : ''),
  };
}

// Empty page, drive: the nearest place past the limit that fits (rankCities()
// lists the places past the limit shortest drive first).
function wkPastLimitTip(byHome) {
  if (!byHome.commuteKnown || byHome.limit === null) return null;
  const e = byHome.overCommute.find((x) => x.comfortable && Number.isFinite(x.commuteMin));
  if (!e) return null;
  const past = e.commuteMin - byHome.limit;
  return {
    kind: 'drive', extra: past, effort: past / WK_DRIVE_CAP_MIN,
    claim: Object.assign(wkClaimOf(e), { lever: 'drive', extra: past, limit: byHome.limit }),
    html: 'Drive <b>' + past + ' minutes past your ' + byHome.limit + '-minute limit</b> and ' + wkHome(e) + ' ' + wkFits(e) + ', about ' + e.commuteMin + ' min each way.',
  };
}

// ── "Also worth a look" (IMPROVEMENT_PLAN.md 2.2b, 2026-09-24) ─────────────
// When the answers leave a card free (two or three answers are the same home,
// or there is no commute to answer), one card on what it takes to get more
// home than the Most home answer. The first match wins:
//   1. Save more: the smallest extra down payment, in WK_STEP steps up to
//      WK_SAVE_CAP, at which a bigger home fits within the buyer's commute
//      limit -- the page's own search run again (wkRun()); the home is the one
//      that search would then put first for most home;
//   2. Drive a bit further: a bigger home that fits today, at most
//      WK_DRIVE_CAP_MIN minutes past the buyer's limit, the nearest first;
//   3. otherwise no card. Never a home that doesn't fit, as padding.
// The card is today's card for that home, so it says what the home costs now:
// a home that is a Stretch today keeps its Stretch label, and only the first
// line of its At a glance says what would change that ("Save $5,000 more
// and..."). A save card therefore needs a home the buyer could buy today
// (qualifyingOption()); one the bank would not lend for yet is passed over
// rather than drawn with figures that are not true today.
// Why: buyers trade the home before the commute (49% would buy smaller, 24%
// would commute longer; Abacus Data for CREA, 2025), and the runner-up for
// most home that stood here was no better than the answer above it on any
// count in 57% of cases (_private/phase2/WORTH_A_LOOK_RESEARCH.md).

// The extra drive in hours a month: minutes each way x 2 x office days a
// week x 4.33 weeks. Daily is 5 days; hybrid is "2-4 days/week" on the form,
// so a range. "about 22–43 more hours a month".
const WK_OFFICE_DAYS = { daily: [5, 5], hybrid: [2, 4] };
function wkHoursAMonth(extraMin) {
  const d = WK_OFFICE_DAYS[workArrangement];
  if (!d || !(extraMin > 0)) return '';
  const h = (days) => Math.round(extraMin * 2 * days * 4.33 / 60);
  const lo = h(d[0]), hi = h(d[1]);
  return 'about ' + (lo === hi ? lo : lo + '–' + hi) + ' more hours a month';
}

// A home as it stands today, as a rankCities() entry (for its card), or null
// when the buyer could not buy it today.
function wkTodayEntry(city, type, commuteMin) {
  const o = qualifyingOption(city, type);
  if (!o) return null;
  return { city, n: city.n, type: o.type, price: o.price, costs: o.costs, fit: o.fit, pct: takeHomePct(o.costs.total), commuteMin, comfortable: isComfortable(o) };
}

// `answers` is answerPicks()'s result; `base` wkBase(). Returns null, or
// { kind: 'save' | 'drive', extra, entry (today), claim, html }.
function wkAlso(base, answers) {
  const byHome = answers.byHome;
  const top = byHome.ranked[0];
  if (!top) return null;
  const bigger = (t) => HOME_RANK[t] > HOME_RANK[top.type];
  const types = base.onlyType ? [base.onlyType] : HOME_ORDER;
  if (!types.some(bigger)) return null;
  const save = wkFirstStep(base, 'save', WK_STEP, WK_SAVE_CAP, (run) => {
    for (const a of run.ranking.ranked) {
      if (!bigger(a.type)) continue;
      const today = wkTodayEntry(a.city, a.type, a.commuteMin);
      if (today) return { after: a, today };
    }
    return null;
  });
  if (save) {
    const { after, today } = save.h;
    return {
      kind: 'save', extra: save.x, entry: today,
      claim: Object.assign(wkClaimOf(after), { lever: 'save', extra: save.x, today: wkClaimOf(today), than: homeKey(top) }),
      html: wkLeverHtml('save', save.x, base) + wkHome(after) + ' ' + wkFits(after) +
        (Number.isFinite(after.commuteMin) ? ', about ' + after.commuteMin + ' min.' : '.'),
    };
  }
  if (!byHome.commuteKnown || byHome.limit === null) return null;
  const e = byHome.overCommute.find((x) => x.comfortable && bigger(x.type) && Number.isFinite(x.commuteMin) && x.commuteMin - byHome.limit <= WK_DRIVE_CAP_MIN);
  if (!e) return null;
  const past = e.commuteMin - byHome.limit;
  const hours = Number.isFinite(top.commuteMin) ? wkHoursAMonth(e.commuteMin - top.commuteMin) : '';
  return {
    kind: 'drive', extra: past, entry: e,
    claim: Object.assign(wkClaimOf(e), { lever: 'drive', extra: past, limit: byHome.limit, than: homeKey(top), extraMin: Number.isFinite(top.commuteMin) ? e.commuteMin - top.commuteMin : null }),
    html: 'A ' + WK_TYPE[e.type] + ' fits in ' + e.n + ': <b>' + past + ' min past your ' + byHome.limit + '-minute limit</b>' + (hours ? ', ' + hours : '') + '.',
  };
}

// ── What render() draws ────────────────────────────────────────────────────
// `answers` is render()'s answerPicks() result; `onlyType` the home-type
// filter. Returns null before a search, else:
//   { empty, limit, onlyType, tips, levers, close, far, nothingFar }
//   empty      -- no place within the limit fits: the "you're close" page;
//   tips       -- in the order shown: the savings tip first when it applies,
//                 then (normal page) the strongest one more, or (empty page)
//                 save, drive, earn -- each { kind, extra, effort, claim, html };
//   levers     -- every save, drive and earn tip worth showing, before the
//                 normal page keeps the strongest (the tests check the rule
//                 on all of them);
//   close      -- empty page: a save, drive or earn tip is within the caps;
//   far        -- empty page, not close: what would change the answer, past
//                 the caps; nothingFar -- not even that, within WK_FAR_*;
//   earnTried  -- false while the buyer's own take-home is in force: no
//                 earn tip was looked for (wkOwnTakeHome());
//   also       -- normal page with a card free: the "Also worth a look" card
//                 (wkAlso()), or null. Its trade is not repeated as a tip
//                 below it (2.2b, "Don't say it twice").
// The result is kept until anything it depends on changes, so opening a card
// or re-sorting "See all places" does not run the engine again.
let _wkCache = null;
function worthKnowing(answers, onlyType) {
  const base = wkBase(onlyType);
  if (!base || !answers || !answers.byHome) return null;
  const key = JSON.stringify([base, lastSearch.calc, workArrangement, workZone, netMonthlyIncome, wkOwnTakeHome(), grossMonthlyIncome, customMortgageRate,
    firstTimeBuyer, fam_selected, buyPower, comfortBuyPower, partnerIncomeShare, (results || []).map((r) => r.n),
    answers.picks.map((p) => homeKey(p.entry))]);
  if (_wkCache && _wkCache.key === key) return _wkCache.value;
  const value = _wkCompute(base, answers);
  _wkCache = { key, value };
  return value;
}

// The buyer typed their own take-home ("Change it", main.js). A search with a
// different income goes back to the estimate (go()), so an "earn more" tip
// cannot say what the page would show at the higher income on the buyer's own
// pay: it would be worked out on a take-home they told us is wrong, or on one
// the page would not use. No earn tip then (2026-09-24). Until then the tip
// scaled the buyer's figure, which a search again never did: for $120K, $60K
// down and an own $7,773/mo, "Earn $20,000 more ... a Good Fit at 42%" and
// "you're close", while the page at $140K showed that condo at 47%, Stretch.
function wkOwnTakeHome() { return typeof takeHomeIsBuyersOwn === 'function' && takeHomeIsBuyersOwn(); }

function _wkCompute(base, answers) {
  const byHome = answers.byHome;
  const earnOk = !wkOwnTakeHome();
  const out = { empty: !byHome.ranked.length, limit: byHome.limit, onlyType: base.onlyType, tips: [], levers: [], close: false, far: [], nothingFar: false, earnTried: earnOk, also: null };
  const sl = savingsLimitTip(lastSearch.calc);
  // The plan's own words: "Your savings are the limit… $X more saved would get
  // you there", where "there" is the HomePilot comfort range the buyer's income
  // alone would give.
  const savingsTip = sl ? {
    kind: 'savings-limit', extra: sl.moreSaved, effort: 0, claim: { comfortCapBP: sl.comfortCapBP, moreSaved: sl.moreSaved },
    html: '<b>Your savings are the limit</b>, not your income. On your income alone your HomePilot comfort range would be <b>' + fc(sl.comfortCapBP) +
      '</b>; about <b>' + fc(sl.moreSaved) + ' more saved</b> would get you there.',
  } : null;

  if (!out.empty) {
    // Each answer place once, with the most home it has today.
    const places = [];
    answers.picks.forEach((p) => {
      if (places.some((x) => x.n === p.entry.n)) return;
      const today = byHome.ranked.find((x) => x.n === p.entry.n) || p.entry;
      places.push({ n: today.n, type: today.type });
    });
    // "Also worth a look" takes a card the answers left free (2.2b).
    out.also = answers.picks.length < ANSWER_CARDS ? wkAlso(base, answers) : null;
    // A tip that makes the same trade for the same home as that card stays
    // out of the box below it.
    const sameAsAlso = (t) => !!out.also && t.kind === out.also.kind && t.claim.n === out.also.claim.n && t.claim.type === out.also.claim.type;
    const levers = [
      wkUpgradeTip(base, 'save', places, WK_SAVE_CAP),
      wkDriveTip(answers, base.onlyType),
      earnOk ? wkUpgradeTip(base, 'earn', places, WK_EARN_CAP) : null,
    ].filter((t) => t && !sameAsAlso(t)).sort((a, b) => a.effort - b.effort || WK_LEVER_ORDER[a.kind] - WK_LEVER_ORDER[b.kind]);
    out.levers = levers;
    out.tips = [savingsTip].concat(levers).filter(Boolean).slice(0, WK_MAX_TIPS);
    return out;
  }

  // One tip per lever (plan 2.0). "You're close" rests on the caps: a save or
  // earn step within them, or a place that fits at most WK_DRIVE_CAP_MIN past
  // the limit. The drive tip itself shows at any distance once the page is
  // close (2026-09-24): the plan's own example names Oshawa "about 100 min" and
  // Hamilton "110 min", and at the 60-minute default the worked example lost
  // its drive tip because Oshawa is 40 minutes past the limit, while the notes
  // said 17 places further out fit. The 30-minute cap is the normal page's rule
  // ("a short extra drive").
  const drive = wkPastLimitTip(byHome);
  const save = wkFirstFitTip(base, 'save', WK_STEP, WK_SAVE_CAP);
  const earn = earnOk ? wkFirstFitTip(base, 'earn', WK_STEP, WK_EARN_CAP) : null;
  out.close = !!(save || earn || (drive && drive.extra <= WK_DRIVE_CAP_MIN));
  const within = out.close ? [save, drive, earn].filter(Boolean) : [];
  out.levers = within;
  out.tips = [savingsTip].concat(within).filter(Boolean);
  if (!out.close) {
    out.far = [
      wkFirstFitTip(base, 'save', WK_SAVE_CAP + WK_STEP, WK_FAR_SAVE_CAP),
      drive,
      earnOk ? wkFirstFitTip(base, 'earn', WK_EARN_CAP + WK_STEP, WK_FAR_EARN_CAP) : null,
    ].filter(Boolean);
    out.nothingFar = !out.far.length;
  }
  return out;
}

// The empty page's heading, written into the count line (#cnt) by render().
// Without a commute limit (remote work, "No limit", or a work location the
// app could not place) there is no "within N minutes".
function wkEmptyHeading(wk) {
  const what = wk && wk.onlyType ? 'No ' + WK_TYPE[wk.onlyType] : 'Nothing';
  const where = wk && wk.limit !== null && wk.limit !== undefined ? ' within ' + wk.limit + ' minutes' : '';
  return '<span>' + what + where + '</span> fits your HomePilot comfort range yet' + (wk && wk.close ? ", but you're close." : '.');
}

// The box, in the style of the "At a glance" box on every card
// (buildWhyRanked(), render-support.js): the same grey panel, small uppercase
// heading and dotted lines. '' when there is nothing worth showing (the
// normal page with no tips); on the empty page it is always there.
function worthKnowingHtml(wk) {
  if (!wk || (!wk.empty && !wk.tips.length)) return '';
  const icon = typeof WHY_ICON !== 'undefined' ? WHY_ICON.neutral : '';
  const row = (t) => '<div class="wk-tip" data-kind="' + t.kind + '"' + (t.kind === 'savings-limit' ? ' id="savingsTip"' : '') + '>' + icon + '<span>' + t.html + '</span></div>';
  let h = wk.tips.map(row).join('');
  if (wk.empty && !wk.close) {
    const limited = wk.limit !== null && wk.limit !== undefined;
    h += wk.far.length
      ? '<div class="wk-lead">What would change the answer (none of it a small step):</div>' + wk.far.map(row).join('')
      : '<div class="wk-lead">No single change we tried gets ' + (limited ? 'a place within ' + wk.limit + ' minutes' : 'a place') +
        ' to fit your HomePilot comfort range: not ' + fc(WK_FAR_SAVE_CAP) + ' more saved' +
        (wk.earnTried === false ? '' : ', and not ' + fc(WK_FAR_EARN_CAP) + ' more household income a year') +
        (limited ? '; and no place further out fits either.' : '.') + '</div>';
  }
  return '<div class="wk-box" id="wkBox"><div class="wk-title">HomePilot Worth Knowing</div>' + h + '</div>';
}
