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
// cities: render() draws its result, the PDF report and Compare are built from
// the cards render() drew, and the What-If scenarios call it directly.
//
// Contains: getPriceForTypeStrict() (unchanged), HOME_ORDER, HOME_RANK,
// RESULT_SORTS, DEFAULT_MAX_COMMUTE, MAX_COMMUTE_CHOICES, commuteEstimateMin(),
// qualifyingOption(), isComfortable(), rankCities(), rankRuleSentence().

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
  const net = netMonthlyIncome || grossMonthlyIncome * 0.72;
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
    // Nothing comfortable: the last option in HOME_ORDER, the cheapest type.
    const chosen = comfortable || options[options.length - 1];
    const commuteMin = commuteKnown ? commuteEstimateMin(city.n) : null;
    const entry = {
      city, n: city.n, type: chosen.type, price: chosen.price, costs: chosen.costs, fit: chosen.fit,
      pct: net > 0 ? Math.round(chosen.costs.total / net * 100) : null,
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

// The rule in force, in one sentence, for the line above the results.
function rankRuleSentence(sort, commuteKnown) {
  if (sort === 'commute') return 'Ranked by shortest estimated drive to work, then the most home you can comfortably afford.';
  if (sort === 'cost') return 'Ranked by lowest monthly cost: each place shows the cheapest home you can comfortably afford there.';
  return commuteKnown
    ? 'Ranked by the most home you can comfortably afford, shortest commute first.'
    : 'Ranked by the most home you can comfortably afford, lowest monthly cost first.';
}
