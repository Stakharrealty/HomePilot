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
  //
  // Returns null when there is no usable cost or income to judge (added
  // 2026-09-22, audit). This was the single most dangerous behaviour in the
  // engine: getFit(null), getFit(0) and getFit(-500) all returned
  // {cls:"fg", lbl:"Great fit", score:100} — a missing or broken cost produced
  // the most reassuring label the product has. getFit(NaN) returned "Stretch"
  // with a score of NaN. Callers must now handle null by showing no badge
  // rather than a guessed one.
  const cost=Number(monthlyCost);
  if(!Number.isFinite(cost)||cost<=0)return null;
  const netIncome=netMonthlyIncome||(Number(_grossMonthlyIncome)*0.72);
  if(!Number.isFinite(netIncome)||netIncome<=0)return null;
  const ratio=monthlyCost/netIncome;
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

// Returns [{ key, tone, text }]: tone is 'good', 'neutral' or 'bad', and
// buildWhyRanked() picks the icon from it (REVIEW_BACKLOG.md P1-6).
//
// CHANGED 2026-09-23 (IMPROVEMENT_PLAN.md 1.4 / 1.5):
//   - The 4th argument is the estimated drive in minutes (rankCities()'s
//     commuteMin), not an access tier. "Limited Commute to your workplace"
//     covered 71 minutes to eight hours; the bullet now states the estimate.
//   - Which home types count, and which are comfortable, come from
//     qualifyingOption() / isComfortable() in ranking.js -- the same full
//     qualification and the same definition of comfortable the ranking uses.
//     These bullets used to check only the minimum down payment and call
//     anything under 45% "within comfort range", so they could disagree with
//     the card they sat on.
function buildWhyRankedBullets(x, c, net, commuteMin, displayPropType, displayPrice) {
  const bullets = [];
  const PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};
  const safenet = (net && net > 0) ? net : null;

  // BULLET 1 — Commute: a fact, not a verdict. The buyer's own limit has
  // already set aside anything too far.
  if(workArrangement === 'daily' || workArrangement === 'hybrid') {
    if(Number.isFinite(commuteMin)) bullets.push({ key:'commute', tone:'neutral', text: 'Estimated commute: about ' + commuteMin + ' min drive each way' });
  } else {
    bullets.push({ key:'commute', tone:'neutral', text: 'Commute not a factor — remote work' });
  }

  // Every type the buyer can actually buy here, cheapest first.
  const options = ['condo','town','semi','detached'].map(tp => qualifyingOption(x, tp)).filter(Boolean);

  // BULLET 2 — Share of take-home across those types
  if(safenet && options.length) {
    const pct = (o) => Math.round(o.costs.total / safenet * 100);
    if(options.length >= 2) {
      bullets.push({ key:'affordability', tone:'neutral', text: 'Homes here from ' + pct(options[0]) + '% to ' + pct(options[options.length - 1]) + '% of take-home pay' });
    } else {
      bullets.push({ key:'affordability', tone:'neutral', text: PLBL[options[0].type] + ' at ' + pct(options[0]) + '% of take-home pay' });
    }
  }

  // BULLET 3 — How many of them are comfortable
  const comfortable = options.filter(isComfortable);
  const plural = (n) => n + ' home type' + (n > 1 ? 's' : '');
  if(comfortable.length > 0 && comfortable.length === options.length) {
    bullets.push({ key:'options', tone:'good', text: plural(comfortable.length) + ' you can comfortably afford' });
  } else if(comfortable.length > 0) {
    bullets.push({ key:'options', tone:'good', text: comfortable.length + ' of ' + options.length + ' home types you can comfortably afford' });
  } else if(options.length > 0) {
    bullets.push({ key:'options', tone:'bad', text: plural(options.length) + ' available — all a stretch' });
  }

  return bullets;
}
