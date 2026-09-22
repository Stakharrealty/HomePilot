// tests/engine_invariants_test.js
// Dense monotonicity + minimum-down-payment invariants for the affordability
// engine. Written during the independent audit (2026-09-22).
//
// These are the properties the existing regression suite CLAIMS to check.
// Its 5-point samples (dn in {25k,50k,100k,150k,200k}) step straight over the
// CMHC-tier discontinuity that breaks them, so it passes while the property
// is false. Run:  node tests/engine_invariants_test.js calculator.html

const fs = require('fs'), path = require('path'), vm = require('vm');
const htmlPath = process.argv[2] || 'calculator.html';
const htmlDir = path.dirname(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');

let src = '';
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const srcAttr = (m[1] || '').match(/\bsrc=["']([^"']+)["']/);
  if (srcAttr) src += fs.readFileSync(path.join(htmlDir, srcAttr[1]), 'utf8') + '\n';
  else if (m[2].trim()) src += m[2] + '\n';
}

const mkEl = () => ({
  style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, appendChild() {}, innerHTML: '', textContent: '',
  value: '', dataset: {}, querySelectorAll() { return []; }, querySelector() { return mkEl(); },
  scrollIntoView() {}, disabled: false,
});
const store = {};
const byId = (id) => (store[id] || (store[id] = mkEl()));
const document = {
  getElementById: byId, querySelectorAll() { return []; }, querySelector() { return mkEl(); },
  addEventListener() {}, createElement() { return mkEl(); }, body: mkEl(), documentElement: mkEl(),
};
const windowObj = {
  addEventListener() {}, location: { href: '', search: '' },
  matchMedia() { return { matches: false, addEventListener() {} }; }, innerWidth: 400, document,
};
const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Date, parseInt, parseFloat,
  isNaN, isFinite, Intl, encodeURIComponent, decodeURIComponent, setTimeout() {}, clearTimeout() {},
  document, window: windowObj, navigator: {}, location: windowObj.location, URLSearchParams,
  history: { replaceState() {} }, fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  Error, Promise, localStorage: { getItem() { return null; }, setItem() {} },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const fails = [];
const t = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; fails.push(name + (detail ? ' :: ' + detail : '')); }
};

run(`firstTimeBuyer=false;customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100;`);

// 1. Dense down-payment monotonicity: $1,000 steps, not 5 sample points.
for (const inc of [80000, 100000, 120000, 150000, 200000, 300000]) {
  let prev = -1, prevDn = 0, bad = null;
  for (let dn = 1000; dn <= 400000; dn += 1000) {
    const bp = run(`calcBP(${inc},${dn},0).bp`);
    if (prev >= 0 && bp < prev && !bad) bad = `dn ${prevDn}->${dn}: bp ${prev}->${bp}`;
    prev = bp; prevDn = dn;
  }
  t(`BP monotonic in down payment @${inc} (dense)`, !bad, bad);
}

// 2. Dense debt monotonicity: more debt must never raise buying power.
for (const inc of [100000, 120000, 150000, 200000]) {
  let prev = Infinity, prevD = 0, bad = null;
  for (let d = 0; d <= 5000; d += 50) {
    const bp = run(`calcBP(${inc},100000,${d}).bp`);
    if (bp > prev && !bad) bad = `debt ${prevD}->${d}: bp ${prev}->${bp}`;
    prev = bp; prevD = d;
  }
  t(`BP non-increasing in debt @${inc} (dense)`, !bad, bad);
}

// 3. A higher mortgage rate must never raise buying power.
{
  let prev = Infinity, prevR = 0, bad = null;
  for (let r = 2.0; r <= 12.0; r += 0.25) {
    run(`customMortgageRate=${r / 100};`);
    const bp = run(`calcBP(120000,100000,0).bp`);
    if (bp > prev && !bad) bad = `rate ${prevR}%->${r}%: bp ${prev}->${bp}`;
    prev = bp; prevR = r;
  }
  run(`customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100;`);
  t('BP non-increasing in mortgage rate', !bad, bad);
}

// 4. The headline number must be a price the buyer could legally close on
//    with the down payment they actually entered (Dept. of Finance rules,
//    in force Dec 15 2024 -- the same ones meetsMinDownPayment() encodes).
const legalMax = (dn) =>
  dn < 25000 ? dn / 0.05
    : dn < 125000 ? 500000 + (dn - 25000) / 0.10
      : Math.max(1500000, dn / 0.20);
for (const [inc, dn] of [[100000, 5000], [200000, 20000], [400000, 50000], [400000, 100000], [200000, 50000]]) {
  const bp = run(`calcBP(${inc},${dn},0).bp`);
  t(`BP respects minimum down payment (inc ${inc}, dn ${dn})`, bp <= legalMax(dn) + 1,
    `bp ${bp} but max purchasable with $${dn} down is $${Math.round(legalMax(dn))}`);
}

// 5. No free mortgage below the 5% insured floor: paying MORE down must never
//    raise the monthly cost.
{
  const a = run(`calcCosts(M.find(c=>c.n==='Brampton'),500000,"3",24999,'detached').mort`);
  const b = run(`calcCosts(M.find(c=>c.n==='Brampton'),500000,"3",25000,'detached').mort`);
  t('monthly cost does not FALL when down payment rises past 5%', a >= b,
    `dn 24999 -> $${a}/mo, dn 25000 -> $${b}/mo`);
}

// 6. A missing or unusable cost must never read as the most reassuring label.
//    getFit() now returns null rather than inventing a tier.
{
  run(`netMonthlyIncome=6000;lang='en';`);
  const cls = (expr) => run(`(function(){var f=${expr};return f?f.cls:null;})()`);
  const score = (expr) => run(`(function(){var f=${expr};return f?f.score:null;})()`);
  t('getFit(null) is not "Great fit"', cls(`getFit(null,8333)`) !== 'fg', `got ${cls(`getFit(null,8333)`)}`);
  t('getFit(0) is not "Great fit"', cls(`getFit(0,8333)`) !== 'fg');
  t('getFit(-500) is not "Great fit"', cls(`getFit(-500,8333)`) !== 'fg');
  t('getFit(NaN) never reports a NaN score',
    score(`getFit(NaN,8333)`) === null || Number.isFinite(score(`getFit(NaN,8333)`)));
  t('getFit still rates a real cost', cls(`getFit(2000,8333)`) === 'fg');
  t('getFit with no income returns null rather than a guess',
    run(`(function(){var s=netMonthlyIncome;netMonthlyIncome=0;var f=getFit(5000,0);netMonthlyIncome=s;return f;})()`) === null);
}

// 6b. When the down payment is the binding constraint, the engine must hand
//     the UI enough to explain WHY the number is what it is — otherwise the
//     buyer just sees a smaller figure with no reason for it. The savings gap
//     is the single most actionable thing to tell someone at this stage.
{
  run(`firstTimeBuyer=false;customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100;`);
  const capped = run(`calcBP(120000,20000,0)`);
  t('a down-payment-limited buyer is flagged as such', capped.downPaymentLimited === true);
  t('the income-only ceiling is reported and exceeds the capped figure',
    capped.incomeCapBP > capped.bp, `${capped.incomeCapBP} vs ${capped.bp}`);
  t('a positive savings shortfall is reported', capped.downPaymentShortfall > 0, capped.downPaymentShortfall);
  // The shortfall must be arithmetically true: adding it to their savings has
  // to actually unlock the income-only ceiling, or the advice is wrong.
  t('down payment + shortfall genuinely reaches the income-only ceiling',
    run(`meetsMinDownPayment(${capped.incomeCapBP}, ${20000 + capped.downPaymentShortfall})`) === true,
    `needs ${run(`minDownPaymentFor(${capped.incomeCapBP})`)}, would have ${20000 + capped.downPaymentShortfall}`);
  t('the shortfall is not overstated (one step less would NOT be enough)',
    run(`meetsMinDownPayment(${capped.incomeCapBP}, ${20000 + capped.downPaymentShortfall - 200})`) === false);

  const funded = run(`calcBP(200000,150000,0)`);
  t('an income-limited buyer is NOT flagged as down-payment-limited', funded.downPaymentLimited === false);
  t('an income-limited buyer gets no savings shortfall', funded.downPaymentShortfall === 0);
  t('for an income-limited buyer the two ceilings agree',
    funded.incomeCapBP === funded.bp, `${funded.incomeCapBP} vs ${funded.bp}`);

  // minDownPaymentFor must be the exact inverse of maxPriceForDownPayment at
  // every band boundary, or the shortfall drifts at exactly the prices where
  // the federal rule steps.
  for (const p of [300000, 499999, 500000, 900000, 1499999, 1500000, 2000000]) {
    const need = run(`minDownPaymentFor(${p})`);
    t(`minDownPaymentFor(${p}) satisfies meetsMinDownPayment`, run(`meetsMinDownPayment(${p}, ${need})`) === true);
    t(`minDownPaymentFor(${p}) is not overstated`, run(`meetsMinDownPayment(${p}, ${need - 1})`) === false);
  }
}

// 7. Unusable inputs must not silently produce a confident wrong number.
{
  // calcCosts coerces rather than returning null (25 call sites, one of which
  // intentionally passes `price || 0`). The property that matters is that it
  // never emits NaN, never emits a negative, and never reports a free house.
  const allFinite = (expr) => run(
    `(function(){var c=${expr};if(!c)return false;
      return Object.keys(c).every(function(k){return Number.isFinite(c[k])&&c[k]>=0;});})()`);

  const und = run(`calcCosts(M.find(c=>c.n==='Brampton'),700000,"3",undefined,'detached')`);
  t('undefined down payment does not yield a $0 mortgage', und && und.mort > 0, `mort=${und && und.mort}`);
  t('undefined down payment is read as zero down, not a paid-off house',
    und && Math.abs(und.mort - run(`calcCosts(M.find(c=>c.n==='Brampton'),700000,"3",0,'detached').mort`)) <= 1);
  t('NaN price produces no NaN line items',
    allFinite(`calcCosts(M.find(c=>c.n==='Brampton'),NaN,"3",100000,'detached')`));
  t('negative price produces no negative line items',
    allFinite(`calcCosts(M.find(c=>c.n==='Brampton'),-500000,"3",100000,'detached')`));
  t('a null market record does not throw',
    allFinite(`calcCosts(null,700000,"3",100000,'detached')`));
  t('a string price is still handled',
    run(`calcCosts(M.find(c=>c.n==='Brampton'),"700000","3",100000,'detached').total`)
    === run(`calcCosts(M.find(c=>c.n==='Brampton'),700000,"3",100000,'detached').total`));
}

// 8. The family-size fallback must stay inside the chosen property type:
//    a condo with an unparseable family size must not be billed detached
//    utilities.
{
  const bad = run(`calcCosts(M.find(c=>c.n==='Brampton'),700000,"abc",100000,'condo').util`);
  const good = run(`calcCosts(M.find(c=>c.n==='Brampton'),700000,"3",100000,'condo').util`);
  t('bad family size does not leak detached utilities into a condo', bad === good,
    `condo util was ${bad}, expected ${good}`);
}

// 9. calcBP's advertised monthly payment must match what calcCosts charges at
//    that same price — they disagreed by the CMHC premium for years.
{
  run(`firstTimeBuyer=false;`);
  const bp = run(`calcBP(120000,80000,0)`);
  const cost = run(`calcCosts(M.find(c=>c.n==='Brampton'),${bp.bp},"3",80000,'detached')`);
  t('calcBP monthly payment matches calcCosts mortgage line at the same price',
    Math.abs(bp.mo - cost.mort) <= 1, `calcBP ${bp.mo} vs calcCosts ${cost.mort}`);
}

console.log(`\nengine invariants: ${pass} passed, ${fail} FAILED`);
fails.forEach((f) => console.log('  x ' + f));
process.exit(fail ? 1 : 0);
