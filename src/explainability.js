// explainability.js — HomePilot "why this fits / why ranked here" logic
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/explainability.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: getFit() (burden % -> Great/Good/Stretch label) and
// buildWhyRankedBullets() (the explainability bullets shown on each city card).

function getFit(monthlyCost,_grossMonthlyIncome){
  // Always use net take-home. If netMonthlyIncome not set, estimate from gross.
  // Passing gross is kept for call-site compatibility but we ignore it here.
  const netIncome=netMonthlyIncome||(_grossMonthlyIncome*0.72);
  const ratio=netIncome>0?monthlyCost/netIncome:1;
  let score;
  if(ratio<0.35){score=Math.round(100-(ratio/0.35)*20);}
  else if(ratio<0.45){score=Math.round(79-((ratio-0.35)/0.10)*19);score=Math.max(60,score);}
  else{score=Math.max(40,Math.round(59-((ratio-0.45)/0.20)*19));}
  score=Math.min(100,Math.max(40,score));
  const t=T[lang];
  if(ratio<0.35)return{lbl:t.fit_great_lbl,cls:"fg",score,msg:t.fit_great_msg,ratio};
  if(ratio<0.45)return{lbl:t.fit_good_lbl,cls:"fo",score,msg:t.fit_good_msg,ratio};
  return{lbl:t.fit_stretch_lbl,cls:"fs",score,msg:t.fit_stretch_msg,ratio};
}

function buildWhyRankedBullets(x, c, net, accessTier, displayPropType, displayPrice) {
  // Returns structured array of bullet strings — used by tests and by buildWhyRanked().
  // Bullets describe WHY THE CITY RANKED — not why the cheapest property ranked.
  const bullets = [];
  const pt = PT[x.n] || {};
  const TIERS = ['condo','town','semi','detached'];
  const PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};
  const safenet = (net && net > 0) ? net : null;

  // BULLET 1 — Commute (city-level signal)
  if(workArrangement === 'daily' || workArrangement === 'hybrid') {
    if(accessTier) bullets.push({ key:'commute', text: accessTier.label + ' to your workplace' });
  } else {
    bullets.push({ key:'commute', text: 'Commute not a factor — remote work' });
  }

  // BULLET 2 — Affordability range across all qualifying types (city-level)
  if(safenet) {
    const qualifying = TIERS.filter(tp => pt[tp] && pt[tp] <= buyPower && meetsMinDownPayment(pt[tp], dn_selected));
    if(qualifying.length >= 2) {
      const lowestPt  = qualifying[0];
      const highestPt = qualifying[qualifying.length - 1];
      const lowestC   = calcCosts(x, pt[lowestPt],  fam_selected, dn_selected, lowestPt);
      const highestC  = calcCosts(x, pt[highestPt], fam_selected, dn_selected, highestPt);
      const loPct     = Math.round(lowestC.total  / safenet * 100);
      const hiPct     = Math.round(highestC.total / safenet * 100);
      bullets.push({ key:'affordability', text: 'Housing options from ' + loPct + '% to ' + hiPct + '% of take-home pay' });
    } else if(qualifying.length === 1) {
      const onlyC   = calcCosts(x, pt[qualifying[0]], fam_selected, dn_selected, qualifying[0]);
      const onlyPct = Math.round(onlyC.total / safenet * 100);
      bullets.push({ key:'affordability', text: PLBL[qualifying[0]] + ' at ' + onlyPct + '% of take-home pay' });
    }
  }

  // BULLET 3 — Comfort zone count vs total available
  const comfortTypes = TIERS.filter(tp => {
    if(!pt[tp] || pt[tp] > buyPower) return false;
    if(!safenet) return false;
    const cc = calcCosts(x, pt[tp], fam_selected, dn_selected, tp);
    return (cc.total / safenet) < 0.45;
  });
  const availableTypes = TIERS.filter(tp => pt[tp] && pt[tp] <= buyPower);
  if(comfortTypes.length > 0 && comfortTypes.length === availableTypes.length) {
    bullets.push({ key:'options', text: comfortTypes.length + ' housing type' + (comfortTypes.length > 1 ? 's' : '') + ' within comfort range' });
  } else if(comfortTypes.length > 0) {
    bullets.push({ key:'options', text: comfortTypes.length + ' of ' + availableTypes.length + ' housing types within comfort range' });
  } else if(availableTypes.length > 0) {
    bullets.push({ key:'options', text: availableTypes.length + ' housing type' + (availableTypes.length > 1 ? 's' : '') + ' available — all stretch territory' });
  }

  return bullets;
}
