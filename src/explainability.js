// explainability.js — HomePilot "why this fits / why ranked here" logic
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/explainability.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: monthlyDebt(), takeHomePct(), getFit() (burden % ->
// Great/Good/Stretch label) and buildWhyRankedBullets() (the explainability
// bullets shown on each city card).

// Debt counts (2026-09-24, IMPROVEMENT_PLAN.md 2.2b (a)). Every "% of
// take-home" and every Great / Good / Stretch label is the home's monthly cost
// PLUS the buyer's other monthly debt payments, over take-home pay. A home's
// monthly cost stays the home's own cost: the debt is the same for every home,
// so it changes no order, only how much of the pay is left. Before this, a
// buyer paying $1,500 a month on loans saw an Oshawa condo at 36%, a Good Fit,
// while 55% of their take-home went to housing and debt; the HomePilot comfort
// range already counted the debt, as a bank does.
// existingDebt is main.js's (the form's "Household monthly debt payments"); on
// the listing pages listing-page-globals.js declares it and listing-fit.js
// sets it from the buyer's saved answers for one computation at a time.
function monthlyDebt(){
  const d = typeof existingDebt !== 'undefined' ? Number(existingDebt) : 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}
// The % of take-home a home's monthly cost stands for, debt included, as the
// cards show it (rounded). null when there is no usable income.
function takeHomePct(monthlyCost){
  const gross = typeof grossMonthlyIncome !== 'undefined' ? grossMonthlyIncome : 0;
  const net = netMonthlyIncome || gross * 0.72;
  const cost = Number(monthlyCost);
  if(!Number.isFinite(net) || net <= 0 || !Number.isFinite(cost)) return null;
  return Math.round((cost + monthlyDebt()) / net * 100);
}

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
  // The home's cost plus the buyer's monthly debt payments (monthlyDebt()
  // above, 2026-09-24). The 35% and 45% lines are unchanged.
  const ratio=(cost+monthlyDebt())/netIncome;
  let score;
  if(ratio<0.35){score=Math.round(100-(ratio/0.35)*20);}
  else if(ratio<0.45){score=Math.round(79-((ratio-0.35)/0.10)*19);score=Math.max(60,score);}
  else{score=Math.max(40,Math.round(59-((ratio-0.45)/0.20)*19));}
  score=Math.min(100,Math.max(40,score));
  const t=T.en;
  if(ratio<0.35)return{lbl:t.fit_great_lbl,cls:"fg",score,ratio};
  if(ratio<0.45)return{lbl:t.fit_good_lbl,cls:"fo",score,ratio};
  return{lbl:t.fit_stretch_lbl,cls:"fs",score,ratio};
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
  const TYPE_WORDS = {condo:'condo',town:'townhouse',semi:'semi-detached home',detached:'detached home'};
  const safenet = (net && net > 0) ? net : null;

  // BULLET 1 — Commute: a fact, not a verdict. The buyer's own limit has
  // already set aside anything too far.
  if(workArrangement === 'daily' || workArrangement === 'hybrid') {
    if(Number.isFinite(commuteMin)) bullets.push({ key:'commute', tone:'neutral', text: 'Estimated commute: about ' + commuteMin + ' min drive each way' });
  } else {
    bullets.push({ key:'commute', tone:'neutral', text: 'Commute not a factor — remote work' });
  }

  // Every type the buyer can actually buy here, in type order: condo,
  // townhouse, semi, detached. Not always cheapest first since the listing
  // prices (2026-09-24), so nothing below may assume it.
  const options = ['condo','town','semi','detached'].map(tp => qualifyingOption(x, tp)).filter(Boolean);

  // BULLET 2 — Share of take-home across those types. Debt included, as on
  // the card (monthlyDebt(), 2026-09-24), and then the line says so: "Homes
  // here from 42% to 47%" read as the homes' share alone.
  if(safenet && options.length) {
    const withDebt = monthlyDebt() > 0;
    const pct = (o) => Math.round((o.costs.total + monthlyDebt()) / safenet * 100);
    if(options.length >= 2) {
      // The lowest and the highest %, not the first and last type: with the
      // listing prices (2026-09-24) a semi can cost less than a townhouse, and
      // "from 25% to 42%" stood over a townhouse at 56%.
      const all = options.map(pct), lo = Math.min(...all), hi = Math.max(...all);
      const span = lo === hi ? 'at ' + lo + '%' : 'from ' + lo + '% to ' + hi + '%';
      bullets.push({ key:'affordability', tone:'neutral', text: withDebt
        ? 'With your debt payments, homes here take ' + span.replace(/^(at|from) /, '') + ' of take-home pay'
        : 'Homes here ' + span + ' of take-home pay' });
    } else {
      bullets.push({ key:'affordability', tone:'neutral', text: withDebt
        ? 'With your debt payments, the ' + TYPE_WORDS[options[0].type] + ' here takes ' + pct(options[0]) + '% of take-home pay'
        : PLBL[options[0].type] + ' at ' + pct(options[0]) + '% of take-home pay' });
    }
  }

  // BULLET 3 — How many of them fit the HomePilot comfort range (the branded
  // name, 2026-09-24; it said "you can comfortably afford").
  const comfortable = options.filter(isComfortable);
  const plural = (n) => n + ' home type' + (n > 1 ? 's' : '');
  const fitWord = (n) => (n === 1 ? ' fits' : ' fit') + ' your HomePilot comfort range';
  if(comfortable.length > 0 && comfortable.length === options.length) {
    bullets.push({ key:'options', tone:'good', text: plural(comfortable.length) + fitWord(comfortable.length) });
  } else if(comfortable.length > 0) {
    bullets.push({ key:'options', tone:'good', text: comfortable.length + ' of ' + options.length + ' home types' + fitWord(comfortable.length) });
  } else if(options.length > 0) {
    bullets.push({ key:'options', tone:'bad', text: plural(options.length) + ' available — all a stretch' });
  }

  return bullets;
}
