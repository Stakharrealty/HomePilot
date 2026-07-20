// ranking.js — HomePilot city ranking / angle-picks logic
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/ranking.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: getPriceForTypeStrict(), RANKING_WEIGHTS, computeCityScore(),
// getAnglePicks(). Note: getPriceForType() (the non-strict variant, used by
// render-adjacent code not yet extracted) intentionally stays in index.html
// for now — only the strict variant was in scope for this module per plan.
// `let workArrangement = 'remote';` also intentionally stays in index.html —
// it's mutable runtime state, not a module-level constant.

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

// Hybrid: balanced but affordability still matters more
// Remote: pure affordability
const RANKING_WEIGHTS = {
  daily:  { affordability: 0.45, commute: 0.55 },
  hybrid: { affordability: 0.65, commute: 0.35 },
  remote: { affordability: 1.00, commute: 0.00 }
};

function computeCityScore(cityData, grossMonthlyIncome, netMonthlyIncome, displayPrice, commuteMin, propType) {
  const c = calcCosts(cityData, displayPrice, fam_selected, dn_selected, propType||'detached');
  const net = netMonthlyIncome || grossMonthlyIncome * 0.72;
  // Affordability score: based on monthly burden % of net income
  const burdenPct = net > 0 ? c.total / net : 1;
  let affordScore;
  if(burdenPct <= 0.28) affordScore = 100;
  else if(burdenPct <= 0.32) affordScore = 95;
  else if(burdenPct <= 0.35) affordScore = 90;
  else if(burdenPct <= 0.40) affordScore = 80;
  else if(burdenPct <= 0.45) affordScore = 65;
  else if(burdenPct <= 0.50) affordScore = 45;
  else if(burdenPct <= 0.55) affordScore = 25;
  else affordScore = 8;

  const w = RANKING_WEIGHTS[workArrangement];

  // Commute score
  let commScore;
  if(workArrangement === 'remote') {
    commScore = 50; // truly irrelevant
  } else if(commuteMin === null) {
    commScore = 50; // unresolved work location = neutral, not a penalty
  } else {
    commScore = getCommuteScore(commuteMin);
  }

  let base = (affordScore * w.affordability) + (commScore * w.commute);

  // Commute is already fully represented in commScore (weighted by RANKING_WEIGHTS).
  // A separate proximity bonus would count the same commute fact twice, so it is
  // intentionally removed. commScore is the single commute signal.

  return { finalScore: base, affordScore, commScore };
}

// ── 4-ANGLE PICKS — replaces getTopPicks ────────────────────────
function getAnglePicks(cities) {
  const net   = netMonthlyIncome || grossMonthlyIncome * 0.72;
  const TIERS = ['detached','semi','town','condo'];
  const PLBL  = {detached:'Detached',semi:'Semi-Detached',town:'Townhouse',condo:'Condo'};

  // Attach commute + best qualifying type to every city
  const enriched = cities.map(function(x) {
    var cm = workArrangement !== 'remote' ? calcCommuteMinutes(x.n) : 0;
    if(workArrangement !== 'remote' && cm === null) return null;
    // Find best qualifying type (highest type under buyPower + <45% burden)
    var bestType = null, bestPrice = null, bestCost = null, bestBurden = 1;
    var lowestBurden = 1, lowestType = null, lowestPrice = null, lowestCost = null;
    for(var i=0; i<TIERS.length; i++) {
      var tp = TIERS[i];
      var p  = getPriceForTypeStrict(x.n, tp, buyPower);
      if(!p) continue;
      var c  = calcCosts(x, p, fam_selected, dn_selected, tp);
      var burden = net > 0 ? c.total/net : 1;
      if(burden < 0.45 && !bestType) { bestType = tp; bestPrice = p; bestCost = c; bestBurden = burden; }
      if(burden < lowestBurden) { lowestBurden = burden; lowestType = tp; lowestPrice = p; lowestCost = c; }
    }
    if(!bestType && !lowestType) return null; // nothing qualifies at all
    // Use best qualifying if exists, else lowest burden for value angle
    return {
      city: x,
      cm: cm || 0,
      bestType:    bestType    || lowestType,
      bestPrice:   bestPrice   || lowestPrice,
      bestCost:    bestCost    || lowestCost,
      bestBurden:  bestType    ? bestBurden : lowestBurden,
      lowestType:  lowestType,
      lowestPrice: lowestPrice,
      lowestCost:  lowestCost,
      lowestBurden:lowestBurden,
      qualifies:   !!bestType, // true = <45% burden exists
      score:       computeCityScore(x, grossMonthlyIncome, net, bestPrice||lowestPrice, cm, bestType||lowestType).finalScore,
    };
  }).filter(Boolean).filter(function(e){ return e.qualifies; }); // only good-fit cities

  if(!enriched.length) return null; // triggers stretch fallback

  // ANGLE 1 — Best Overall: highest weighted score
  enriched.sort(function(a,b){ return b.score - a.score; });
  var overall = enriched[0];
  var used = [overall.city.n];

  // ANGLE 2 — Best Commute: shortest drive (different city)
  var byCommute = enriched.slice().sort(function(a,b){ return a.cm - b.cm; });
  var commute = byCommute.find(function(e){ return used.indexOf(e.city.n) === -1; }) || null;
  if(commute) used.push(commute.city.n);

  // ANGLE 3 — Most House: highest property type tier within comfort range
  // Tiebreaker: shortest commute — closest city that offers the biggest house wins
  var tierRank = {detached:4,semi:3,town:2,condo:1};
  var byHouse = enriched.slice().sort(function(a,b){
    var ta = tierRank[a.bestType]||0, tb = tierRank[b.bestType]||0;
    if(tb !== ta) return tb - ta;
    return a.cm - b.cm; // closest first among same tier
  });
  var house = byHouse.find(function(e){ return used.indexOf(e.city.n) === -1; }) || null;
  if(house) used.push(house.city.n);

  // ANGLE 4 — Most Financial Freedom: highest remaining cash flow after housing
  // net income minus monthly housing cost — no arbitrary commute cap needed
  var byFreedom = enriched.slice().sort(function(a,b){
    var cashA = net - a.lowestCost.total;
    var cashB = net - b.lowestCost.total;
    return cashB - cashA; // highest cash left over wins
  });
  var value = byFreedom.find(function(e){ return used.indexOf(e.city.n) === -1; }) || null;

  return {
    overall: overall,
    commute: commute,
    house:   house,
    value:   value,
  };
}
