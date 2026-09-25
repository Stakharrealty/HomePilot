// ranking.js — HomePilot city ranking: one rule, used everywhere
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Loaded via <script src="src/ranking.js"></script>,
// same shared global scope as the rest of the app.
//
// REWRITTEN 2026-09-23 (IMPROVEMENT_PLAN.md 1.4; REVIEW_BACKLOG.md P0-2, P1-22,
// P1-23). Three different systems used to order cities:
//   - computeCityScore(): a weighted sum of an affordability score and a
//     commute score, which set the order on screen;
//   - homePilotSort() (homepilot-score.js): a hidden 1-10 "desirability" score
//     per city, weighted more heavily for higher incomes, which set the order
//     the LEAD email was built from;
//   - getAnglePicks(): a third blend, behind the What-If scenarios.
// None of them could rule a city out on commute -- the commute score bottomed
// out at 3 for anything over two hours -- so a hybrid buyer working in Toronto
// got Welland (186 minutes each way by the app's own table) at #1, and Ottawa
// ahead of Etobicoke. And the screen, the lead and the scenarios each told the
// buyer something different.
//
// Now there is one rule, in one sentence:
//   "The most home you can comfortably afford, shortest commute first."
// The buyer can re-sort by shortest commute or lowest monthly cost, and sets
// their own longest acceptable commute; a city past it is set aside BEFORE
// ranking, never ranked low. rankCities() is the only thing that orders
// cities: render() draws its result, Compare is built from the cards render()
// drew, and HomePilot Worth Knowing calls it directly (through searchAgain()).
//
// Contains: getPriceForTypeStrict() (unchanged), HOME_ORDER, HOME_RANK,
// RESULT_SORTS, DEFAULT_MAX_COMMUTE, MAX_COMMUTE_CHOICES, commuteEstimateMin(),
// qualifyingOption(), isComfortable(), rankCities(), answerPicks() and
// answerMergeLine() (the answer cards at the top of the results, 2026-09-24),
// HOME_TYPE_WORDS, rankRuleSentence().

function getPriceForTypeStrict(cityName,type,bp){
  const t=PT[cityName];if(!t)return type==='all'?bp:null;
  const price=t[type];
  if(!price)return null;
  if(price>bp)return null;
  // Explicit down payment safety check — income qualifying alone is not enough.
  if(!meetsMinDownPayment(price,dn_selected))return null;
  // Full bank-style qualification: real city tax rate, 50% of condo fee (if applicable),
  // dynamic stress test, correct amortization for the down-payment ratio. More accurate
  // than the generic bp ceiling above, which uses a blended estimate before a city/type
  // is known — this catches cases the generic ceiling would miss (e.g. a condo that looks
  // affordable until its fee is properly weighted into the debt-service ratios).
  if(!qualifiesForProperty(grossMonthlyIncome*12, dn_selected, existingDebt, price, type, cityName))return null;
  return price;
}

// "Most home": detached, then semi, then townhouse, then condo -- the order the
// app has always used to pick a city's headline home.
const HOME_ORDER = ['detached', 'semi', 'town', 'condo'];
const HOME_RANK = { detached: 4, semi: 3, town: 2, condo: 1 };

// home    -- the most home you can comfortably afford, shortest commute first
// commute -- shortest estimated drive first
// cost    -- lowest monthly cost first
const RESULT_SORTS = ['home', 'commute', 'cost'];

// The default "longest commute you'd accept (one way)": 60 minutes for daily
// and hybrid alike (IMPROVEMENT_PLAN.md 2.2a, 2026-09-24; hybrid was 90). The
// buyer can still pick 75 or 90, or no limit. Remote workers have no commute
// to limit.
const DEFAULT_MAX_COMMUTE = { daily: 60, hybrid: 60 };
const MAX_COMMUTE_CHOICES = [30, 45, 60, 75, 90];

// The estimated one-way rush-hour drive to work, rounded to 5 minutes. This is
// both the number a card shows and the number the buyer's limit is checked
// against, so they can never disagree (a card reading "about 60 min" hidden by
// a 60-minute limit). null when there is nothing to measure: remote work, or a
// work location the app could not place.
function commuteEstimateMin(cityName) {
  if (workArrangement === 'remote' || !workZone) return null;
  const m = calcCommuteMinutes(cityName);
  return Number.isFinite(m) ? Math.max(5, Math.round(m / 5) * 5) : null;
}

// One home type in one city, if the buyer can actually buy it: listed in the
// price table, within the bank's ceiling, meeting the minimum down payment and
// passing full per-property qualification (getPriceForTypeStrict). Returns it
// with its monthly costs and fit label, or null.
function qualifyingOption(city, type) {
  const price = getPriceForTypeStrict(city.n, type, buyPower);
  if (!price) return null;
  const costs = calcCosts(city, price, fam_selected, dn_selected, type);
  const fit = getFit(costs.total, grossMonthlyIncome);
  if (!fit) return null;
  return { type, price, costs, fit };
}

// Comfortable means BOTH inside the comfort range (comfortBuyPower) AND not
// labelled Stretch. The comfort range uses bank-style ratios on gross income;
// the label uses full monthly costs against take-home pay; and the two
// disagree (REVIEW_BACKLOG.md P1-2 -- a $475K Welland townhouse was under the
// $520K "comfort range" and labelled Stretch on the same card). Which single
// definition to keep is still an open decision (IMPROVEMENT_PLAN.md 2.1).
// Requiring both until then means no card can say "comfortable" and "Stretch"
// about the same home, and the #1 card is never a Stretch.
function isComfortable(opt) {
  return !!opt && opt.price <= comfortBuyPower && opt.fit.cls !== 'fs';
}

function _byName(a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; }
function _commuteKey(e) { return e.commuteMin === null ? Infinity : e.commuteMin; }

function _comparatorFor(sort, commuteKnown) {
  const home = (a, b) => HOME_RANK[b.type] - HOME_RANK[a.type];
  const drive = (a, b) => commuteKnown ? _commuteKey(a) - _commuteKey(b) : 0;
  const cost = (a, b) => a.costs.total - b.costs.total;
  if (sort === 'commute') return (a, b) => drive(a, b) || home(a, b) || cost(a, b) || _byName(a, b);
  if (sort === 'cost') return (a, b) => cost(a, b) || drive(a, b) || _byName(a, b);
  return (a, b) => home(a, b) || drive(a, b) || cost(a, b) || _byName(a, b);
}

// Orders cities for this buyer. `cities` is the candidate list (go()'s
// `results`); options:
//   sort       -- one of RESULT_SORTS (default 'home'; 'commute' falls back to
//                 'home' when there is no commute to sort by);
//   maxCommute -- the buyer's longest acceptable one-way drive in minutes, or
//                 null for no limit;
//   onlyType   -- a home type the buyer filtered to, or null for all types.
// Returns:
//   ranked      -- cities with a comfortable home, in order. Each shows the
//                  most home the buyer can comfortably afford there -- or,
//                  sorted by 'cost', the cheapest home they can comfortably
//                  afford there.
//   stretchOnly -- cities the bank would lend for, but where nothing is
//                  comfortable; each shows its cheapest option, lowest cost first.
//   overCommute -- cities past the commute limit, shortest drive first. Never
//                  ranked; the page lists them only if the buyer asks.
//   sort, commuteKnown, limit -- what was actually applied.
// Every entry: { city, n, type, price, costs, fit, pct, commuteMin, comfortable }.
function rankCities(cities, opts) {
  const o = opts || {};
  const onlyType = o.onlyType && HOME_RANK[o.onlyType] ? o.onlyType : null;
  const types = onlyType ? [onlyType] : HOME_ORDER;
  const commuteKnown = workArrangement !== 'remote' && !!workZone;
  const limit = commuteKnown && Number.isFinite(o.maxCommute) && o.maxCommute > 0 ? o.maxCommute : null;
  // Decided before the loop: the sort also picks which home each card leads with.
  const sort = RESULT_SORTS.includes(o.sort) && (o.sort !== 'commute' || commuteKnown) ? o.sort : 'home';
  const ranked = [], stretchOnly = [], overCommute = [];
  const seen = new Set();
  for (const city of cities || []) {
    if (!city || !city.n || seen.has(city.n)) continue;
    seen.add(city.n);
    const options = types.map((t) => qualifyingOption(city, t)).filter(Boolean);
    if (!options.length) continue;
    // Which comfortable home a card leads with depends on the sort. "Most
    // home" and "shortest commute" lead with the most home (HOME_ORDER puts
    // detached first). "Lowest monthly cost" leads with the cheapest. Until
    // 2026-09-23 it led with the most home too, and sorted by that, so a
    // place with a $2,426 condo ranked below a condo-only place at $2,916.
    const comfortableOpts = options.filter(isComfortable);
    const comfortable = !comfortableOpts.length ? null
      : sort === 'cost' ? comfortableOpts.reduce((a, b) => (b.costs.total < a.costs.total ? b : a))
      : comfortableOpts[0];
    // Nothing comfortable: the cheapest home by monthly cost. It was the last
    // option in HOME_ORDER, which stopped being the cheapest type when the
    // listing prices put some semis below townhouses (2026-09-24).
    const chosen = comfortable || options.reduce((a, b) => (b.costs.total < a.costs.total ? b : a));
    const commuteMin = commuteKnown ? commuteEstimateMin(city.n) : null;
    const entry = {
      city, n: city.n, type: chosen.type, price: chosen.price, costs: chosen.costs, fit: chosen.fit,
      // Housing plus the buyer's monthly debt payments (takeHomePct(),
      // explainability.js; 2026-09-24).
      pct: takeHomePct(chosen.costs.total),
      commuteMin, comfortable: !!comfortable,
    };
    if (limit !== null && commuteMin !== null && commuteMin > limit) overCommute.push(entry);
    else if (comfortable) ranked.push(entry);
    else stretchOnly.push(entry);
  }
  ranked.sort(_comparatorFor(sort, commuteKnown));
  stretchOnly.sort(_comparatorFor('cost', commuteKnown));
  overCommute.sort(_comparatorFor('commute', true));
  return { ranked, stretchOnly, overCommute, sort, commuteKnown, limit };
}

// ── The answers at the top of the results (2026-09-24) ─────────────────────
// IMPROVEMENT_PLAN.md 2.2, "Three answers, not tabs", and 2.2b: the first
// cards answer one question each -- Lowest monthly cost, Shortest commute,
// Most home, in that order (2.2b: lowest cost first, the nature of HomePilot;
// on a phone that is the stacking order, on a computer left to right) -- and
// each shows that question's winner: the #1 of rankCities() under that sort,
// with the same commute limit and home-type filter as the rest of the page.
//   - The same place can win twice with a different home (a Brampton detached
//     for most home, a Brampton condo for lowest cost). Both are shown.
//   - Two or three answers with the IDENTICAL home (same place, same home
//     type) share one card, labelled with each ("Lowest monthly cost ·
//     Shortest commute"), at the place of its first answer. answerMergeLine()
//     below says why, as the first line of its At a glance.
//   - No commute answer when there is no commute (remote work, or a work
//     location the app could not place).
//   - A merge or a missing commute answer leaves a free slot. It no longer
//     goes to the runner-up for most home, which in 57% of cases was no better
//     than the answer above it on any count (2.2b): render() asks
//     wkAlso() (worth-knowing.js, through worthKnowing()) for one card on what it takes to get
//     more home, or shows none.
// Returns { picks: [{ entry, answers }], byHome, byCommute, byCost, commuteKnown,
// onlyType } (onlyType: the home-type filter the answers were picked under).
// Each pick's entry is a rankCities() entry; answers lists the questions it
// answers, in order ('cost', 'commute', 'home').
const ANSWER_LABELS = { home: 'Most home', commute: 'Shortest commute', cost: 'Lowest monthly cost', also: 'Also worth a look' };
const ANSWER_ORDER = ['cost', 'commute', 'home'];
const ANSWER_CARDS = 3;
// Home types in a sentence ("every place that fits offers a condo"). Also
// HomePilot Worth Knowing's words (WK_TYPE, worth-knowing.js).
const HOME_TYPE_WORDS = { condo: 'condo', town: 'townhouse', semi: 'semi-detached home', detached: 'detached home' };
const HOME_TYPE_PLURALS = { condo: 'condos', town: 'townhouses', semi: 'semi-detached homes', detached: 'detached homes' };
// One home: a place and a home type.
function homeKey(e) { return e.n + '|' + e.type; }
function answerPicks(cities, opts) {
  const o = opts || {};
  const rank = (sort) => rankCities(cities, { sort, maxCommute: o.maxCommute, onlyType: o.onlyType });
  const byHome = rank('home'), byCost = rank('cost');
  const byCommute = byHome.commuteKnown ? rank('commute') : null;
  const top = { cost: byCost.ranked[0], commute: byCommute && byCommute.ranked[0], home: byHome.ranked[0] };
  const picks = [];
  ANSWER_ORDER.forEach((q) => {
    const e = top[q];
    if (!e) return;
    const same = picks.find((p) => homeKey(p.entry) === homeKey(e));
    if (same) same.answers.push(q);
    else picks.push({ entry: e, answers: [q] });
  });
  return { picks, byHome, byCommute, byCost, commuteKnown: byHome.commuteKnown, onlyType: o.onlyType || null };
}

// Why one card carries two or three labels: the first line of its At a
// glance, in the wordings the user approved (IMPROVEMENT_PLAN.md 2.2b, and
// PHASE #3 D5, 2026-09-24). `answers` is the card's answers; `byHome`
// answerPicks()'s "most home" ranking; `entry` the card's home; `onlyType`
// the buyer's home-type filter, or null. null for a card with one label.
//   - Only one home fits (5b): the card carries every answer the page has,
//     and one place fits. Then that place has one home that fits, or its
//     cheapest and its most home would be two cards.
//   - A home-type filter (5a): the line names the type, because the answers
//     only compared that type. "Nothing that fits is cheaper, closer or
//     bigger" stood over a townhouse while a cheaper, closer condo fitted.
//     Under a filter "most home" can't tell two places apart, so it goes
//     with the closest (or, with no commute, the cheapest).
//   - Otherwise the approved lines. "Every place that fits offers a condo"
//     when every place's most home that fits is that one type: then "most
//     home" can only be decided by the next rule (the shortest drive, or with
//     no commute the lowest monthly cost). The two lines for a remote buyer's
//     card, the cheapest and the biggest, follow the same pattern (5c: kept).
function answerMergeLine(answers, byHome, entry, onlyType) {
  const a = new Set(answers || []);
  if (a.size < 2 || !entry) return null;
  const why = 'Why ' + (a.size === 3 ? 'three' : 'two') + ' labels: ';
  const word = HOME_TYPE_WORDS[entry.type] || 'home';
  const everyAnswer = !!byHome && a.size === (byHome.commuteKnown ? 3 : 2);
  if (everyAnswer && byHome.ranked.length === 1) return why + "it's the only " + (onlyType ? word : 'home') + ' that fits your HomePilot comfort range.';
  if (onlyType) {
    if (a.size === 3) return why + 'no other ' + word + ' that fits your HomePilot comfort range is cheaper, closer or bigger.';
    if (a.has('cost') && a.has('commute')) return why + "it's the cheapest " + word + ' that fits, and also the shortest drive.';
    return why + "you're looking at " + (HOME_TYPE_PLURALS[onlyType] || 'homes') + ' only, so the ' + (a.has('commute') ? 'closest' : 'cheapest') + ' one is also the most home.';
  }
  if (a.has('cost') && a.has('commute') && a.has('home')) return 'Why three labels: nothing that fits your HomePilot comfort range is cheaper, closer or bigger.';
  if (a.has('cost') && a.has('commute')) return "Why two labels: it's the cheapest home that fits, and also the shortest drive.";
  const oneType = !!byHome && byHome.ranked.length > 0 && byHome.ranked.every((e) => e.type === entry.type);
  if (a.has('commute')) return oneType
    ? 'Why two labels: every place that fits offers a ' + word + ', so the closest one also gives you the most home.'
    : "Why two labels: it's the biggest home that fits, and also the shortest drive.";
  return oneType
    ? 'Why two labels: every place that fits offers a ' + word + ', so the cheapest one also gives you the most home.'
    : "Why two labels: it's the biggest home that fits, and also the cheapest.";
}

// The rule in force, in one sentence: the order of "See all places" (render.js).
function rankRuleSentence(sort, commuteKnown) {
  // "That fits your HomePilot comfort range", the page's own words, since
  // 2026-09-24 (it said "you can comfortably afford"; plan 2.2: always the
  // branded name).
  if (sort === 'commute') return 'Ranked by shortest estimated drive to work, then the most home that fits your HomePilot comfort range.';
  if (sort === 'cost') return 'Ranked by lowest monthly cost: each place shows the cheapest home that fits your HomePilot comfort range there.';
  return commuteKnown
    ? 'Ranked by the most home that fits your HomePilot comfort range, shortest commute first.'
    : 'Ranked by the most home that fits your HomePilot comfort range, lowest monthly cost first.';
}
