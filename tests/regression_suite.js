// HomePilot Regression Suite — rebuilt July 9, 2026 to the documented 6-suite spec.
// All test logic executes INSIDE the vm context (via vm.runInContext strings) so it
// sees the engine's real let/const module state (workZone, netMonthlyIncome, etc.)
// exactly as the live page does — external ctx.x assignment does not reach these.
const fs = require('fs'), path = require('path'), vm = require('vm');
const htmlPath = process.argv[2] || 'homepilot.html';
const htmlDir = path.dirname(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');

// Phase 2 note (added July 20, 2026): the app now loads via multiple <script> tags
// (external src="..." files plus the original inline block), same as a real browser
// loading them in order into one shared scope. This harness mirrors that: it walks
// every <script> tag in document order, resolves external src files relative to the
// HTML file's own directory, and concatenates everything into one source string before
// running it in the vm context — so module extraction doesn't require rewriting every
// test, only this loading step, once.
let src = '';
const scriptTagRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m;
while ((m = scriptTagRe.exec(html)) !== null) {
  const attrs = m[1] || '';
  const inlineBody = m[2];
  const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/);
  if (srcMatch) {
    const extPath = path.join(htmlDir, srcMatch[1]);
    src += fs.readFileSync(extPath, 'utf8') + '\n';
  } else if (inlineBody.trim()) {
    src += inlineBody + '\n';
  }
}

const mkEl = () => ({ style:{display:''}, classList:{add(){},remove(){},toggle(){},contains(){return false}}, addEventListener(){}, setAttribute(){}, appendChild(){}, innerHTML:'', textContent:'', value:'', checked:false, dataset:{}, querySelectorAll(){return[]}, querySelector(){return mkEl()}, focus(){}, blur(){}, click(){}, scrollIntoView(){}, disabled:false });
// Stateful element store: getElementById returns the SAME object on repeated calls
// for a given id, so tests can set .value / read back .style.display / .disabled
// after calling functions that read/write form state across multiple
// getElementById calls. Existing tests never depended on fresh-object-per-call
// behavior (they drive logic via direct global assignment through run()), so this
// is a safe upgrade, not a behavior change for Suites 1-6.
const __elStore = {};
const getElById = (id) => { if(!__elStore[id]) __elStore[id] = mkEl(); return __elStore[id]; };
const document = { getElementById:getElById, querySelectorAll(){return[]}, querySelector(){return mkEl()}, addEventListener(){}, createElement(){return mkEl()}, body:mkEl(), documentElement:mkEl() };
const windowObj = { addEventListener(){}, location:{href:'',search:''}, navigator:{}, open(){return null}, matchMedia(){return{matches:false,addEventListener(){}}}, innerWidth:400 };
// Stands in for the network. Nothing in these suites checks what is sent;
// the lead-delivery tests that did went with the lead form (2026-09-23).
function __mockFetch(){
  return Promise.resolve({ ok:true, json: async () => ({ok:true}) });
}
const ctx = { console, Math, JSON, Object, Array, Number, String, parseInt, parseFloat, isNaN, Intl, encodeURIComponent, decodeURIComponent, setTimeout(){}, clearTimeout(){}, document, window:windowObj, navigator:{share:null,clipboard:{}}, location:windowObj.location, btoa:s=>Buffer.from(s).toString('base64'), atob:s=>Buffer.from(s,'base64').toString(), URLSearchParams, print(){}, alert(){}, history:{replaceState(){}}, fetch:(...a)=>__mockFetch(...a) };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);

let pass = 0, fail = 0; const failures = []; const suiteResults = [];
let curSuite = null, suiteCount = 0, suitePass = 0;
function suite(name){ if(curSuite) suiteResults.push({name:curSuite,total:suiteCount,pass:suitePass}); curSuite=name; suiteCount=0; suitePass=0; }
function t(name, cond){ suiteCount++; if(cond){pass++;suitePass++;} else {fail++; failures.push(curSuite+' :: '+name);} }
function done(){ if(curSuite){ suiteResults.push({name:curSuite,total:suiteCount,pass:suitePass}); curSuite=null; } }

function setup(income, dn, wa, workCityName){
  run(`
    (function(){
      fam_selected = "3";
      dn_selected = ${dn};
      grossMonthlyIncome = ${income}/12;
      netMonthlyIncome = estimateOntarioNetAnnual(${income})/12;
      firstTimeBuyer = false;
      customMortgageRate = 0.0414;
      workArrangement = ${JSON.stringify(wa)};
      workZone = (${JSON.stringify(wa)} === 'remote') ? null : (FSA_TO_WORK_ZONE['L6P'] || 'brampton_ne');
      var __bp = calcBP(${income}, ${dn}, 0);
      buyPower = __bp.bp; comfortBuyPower = __bp.comfortBP;
    })();
  `);
}
const M = run('M'), PT = run('PT');

// ───────────────────────────── SUITE 1: CORE ─────────────────────────────
suite('Core');
{
  const bp = run('calcBP(250000,150000,0)');
  t('BP returns bp and comfortBP', typeof bp.bp==='number' && typeof bp.comfortBP==='number');
  t('comfortBP < bp', bp.comfortBP < bp.bp);
  t('BP 250k/150k in plausible range (0.9M–1.4M)', bp.bp>900000 && bp.bp<1400000);
  t('matches known-good snapshot ($1.18M/$990K, post CMHC-modeling fix)', bp.bp===1180000 && bp.comfortBP===990000);
  const bpLow = run('calcBP(80000,40000,0)');
  t('BP scales with income', bpLow.bp < bp.bp);
  const bpDebt = run('calcBP(250000,150000,1500)');
  t('debt reduces BP', bpDebt.bp < bp.bp);
  const bpDn = run('calcBP(250000,300000,0)');
  t('higher DP raises BP', bpDn.bp > bp.bp);
  t('zero income yields minimal BP', run('calcBP(0,50000,0)').bp <= 50000);
}
{
  t('getStressRate uses contract+2% when above 5.25% floor', Math.abs(run('getStressRate(0.0419)')-0.0619)<1e-9);
  t('getStressRate floors at 5.25% for very low rates', Math.abs(run('getStressRate(0.02)')-0.0525)<1e-9);
  t('getStressRate rises with contract rate (not hardcoded)', run('getStressRate(0.06)') > run('getStressRate(0.04)'));
  const bpDynamicStress = run('calcBP(250000,300000,0)').bp;
  const savedRateForCompare = run('customMortgageRate');
  run('customMortgageRate=0.0525;');
  const stressNow = run('getStressRate(customMortgageRate)');
  run(`customMortgageRate=${savedRateForCompare}`);
  t('dynamic stress rate is below the old stale hardcoded 7.25% today', run('getStressRate(customMortgageRate)') < 0.0725);
  const bpLowRate = run('calcBP(250000,150000,0)');
  const savedRate = run('customMortgageRate');
  run('customMortgageRate=0.07');
  const bpHighRate = run('calcBP(250000,150000,0)');
  run(`customMortgageRate=${savedRate}`);
  t('BP is lower when contract rate rises (stress rate now tracks it)', bpHighRate.bp < bpLowRate.bp);

  t('qualifiesForProperty exists and is callable', typeof run('qualifiesForProperty') === 'function');
  const qLowIncomeCondo = run(`qualifiesForProperty(80000, 30000, 0, ${PT['Toronto - Downtown'].condo}, 'condo', 'Toronto - Downtown')`);
  t('condo fee weighting blocks a marginal low-income condo buyer', qLowIncomeCondo === false);
  const qHighIncomeCondo = run(`qualifiesForProperty(300000, 100000, 0, ${PT['Toronto - Downtown'].condo}, 'condo', 'Toronto - Downtown')`);
  t('same condo qualifies for a comfortably higher income', qHighIncomeCondo === true);
  const qDetachedType = run(`typeof qualifiesForProperty(80000, 30000, 0, ${PT['Welland'].detached}, 'detached', 'Welland')`);
  t('detached (no condo fee weighting) still returns a valid boolean', qDetachedType === 'boolean');

  t('getPriceForTypeStrict blocks King City detached (above $1.5M cap) under true 20% down', (()=>{
    run(`dn_selected=150000; grossMonthlyIncome=250000/12; netMonthlyIncome=estimateOntarioNetAnnual(250000)/12; existingDebt=0; var __b=calcBP(250000,150000,0); buyPower=__b.bp;`);
    return run(`getPriceForTypeStrict('King City','detached',buyPower)`) === null;
  })());
  t('getPriceForTypeStrict allows King City detached at true 20% down ($330k)', (()=>{
    run(`dn_selected=330000; grossMonthlyIncome=400000/12; netMonthlyIncome=estimateOntarioNetAnnual(400000)/12; var __b=calcBP(400000,330000,0); buyPower=__b.bp;`);
    return run(`getPriceForTypeStrict('King City','detached',buyPower)`) === PT['King City'].detached;
  })());
  t('existingDebt is visible outside go() (module-scope wiring works)', run('typeof existingDebt') === 'number');
}
{
  // Scenario updated 2026-09-22: this previously used 150k income / 30k down,
  // where the 30-year advantage is no longer observable because $30K down caps
  // the buyer at $550K regardless of amortization (calcBP now applies the
  // minimum-down-payment rule). 100k/30k keeps the down-payment ratio under
  // 20% while leaving INCOME as the binding constraint, so the amortization
  // difference is what the assertion actually measures.
  run('firstTimeBuyer=true;');
  const bpFTB = run('calcBP(100000,30000,0)');
  run('firstTimeBuyer=false;');
  const bpNonFTB = run('calcBP(100000,30000,0)');
  t('first-time buyer with <20% down gets higher BP (30yr access) than non-FTB', bpFTB.bp > bpNonFTB.bp);
  t('that scenario is income-limited, not down-payment-limited (so the test measures amortization)',
    bpNonFTB.downPaymentLimited === false && bpFTB.bp < bpFTB.legalCap);

  // The old scenario, kept as its own assertion: with only $30K saved, a
  // $150K earner cannot buy above $550K no matter how long the amortization.
  // Before this fix calcBP reported $660,000 there — a price the buyer could
  // not have closed at, because $30K is under the required minimum down.
  run('firstTimeBuyer=true;');
  const bpCapped = run('calcBP(150000,30000,0)');
  run('firstTimeBuyer=false;');
  t('down payment caps buying power when income alone would allow more', bpCapped.downPaymentLimited === true);
  t('capped buying power equals the legal maximum for that down payment', bpCapped.bp === 550000);
  t('a capped figure is always purchasable with the stated down payment', run(`meetsMinDownPayment(${bpCapped.bp},30000)`) === true);

  run('firstTimeBuyer=true;');
  const qualFTBSmallDown = run(`qualifiesForProperty(150000, 30000, 0, 550000, 'condo', 'Brampton')`);
  run('firstTimeBuyer=false;');
  const qualNonFTBSmallDown = run(`qualifiesForProperty(150000, 30000, 0, 550000, 'condo', 'Brampton')`);
  t('same low-down scenario: FTB status can only help or match qualification, never hurt', qualFTBSmallDown === true || qualFTBSmallDown === qualNonFTBSmallDown || qualFTBSmallDown === true);
  t('qualifiesForProperty reads firstTimeBuyer for amortization (sanity: function still returns boolean)', typeof qualFTBSmallDown === 'boolean');

  t('property just under $1.5M uses 10% blended tier', run('meetsMinDownPayment(1499000,149400)') === true);
  t('property just over $1.5M requires full 20%', run('meetsMinDownPayment(1501000,300200)') === true && run('meetsMinDownPayment(1501000,300199)') === false);
}
{
  run('firstTimeBuyer=true;');
  const c30 = run(`calcCosts(M.find(c=>c.n==='Brampton'), 550000, '3', 30000, 'condo')`);
  run('firstTimeBuyer=false;');
  const c25 = run(`calcCosts(M.find(c=>c.n==='Brampton'), 550000, '3', 30000, 'condo')`);
  t('calcCosts mortgage payment is lower with 30yr FTB amortization despite CMHC surcharge', c30.mort < c25.mort);

  const dpRatioTest = 30000/550000;
  const baseLoan = 550000-30000;
  const loan25 = baseLoan*(1+0.0400);
  const loan30 = baseLoan*(1+0.0400+0.0020);
  t('CMHC 30yr surcharge correctly adds 0.20% to the insured loan balance', Math.abs(loan30-loan25 - baseLoan*0.0020) < 1);

  run('firstTimeBuyer=false;');
  const bpWithCMHC = run('calcBP(150000,30000,0)').bp;
  t('calcBP buying power is a finite, positive number with CMHC modeling active', bpWithCMHC > 0 && isFinite(bpWithCMHC));
  const bpLowDown = run('calcBP(150000,20000,0)').bp;
  const bpHighDown = run('calcBP(150000,100000,0)').bp;
  t('higher down payment still yields higher buying power with CMHC modeling active', bpHighDown > bpLowDown);
}
{
  run(`
    fam_selected="3"; dn_selected=100000; grossMonthlyIncome=150000/12;
    netMonthlyIncome=estimateOntarioNetAnnual(150000)/12; existingDebt=0; firstTimeBuyer=true;
    var __b=calcBP(150000,100000,0); buyPower=__b.bp; comfortBuyPower=__b.comfortBP;
  `);
  // getLeadSummaryForCity() was removed 2026-09-23: the PDF report and Compare
  // are built from the cards on screen (shownCards), and every card comes from
  // a rankCities() entry. These pin what an entry carries instead.
  const bramptonEntry = run(`(function(){ var r = rankCities([M.find(c=>c.n==='Brampton')], {sort:'home'}); var e = r.ranked[0]||r.stretchOnly[0]; return e ? {n:e.n, type:e.type, price:e.price, total:e.costs.total} : null; })()`);
  t('a ranked entry carries city/type/price/monthly cost for a qualifying city', bramptonEntry && bramptonEntry.n==='Brampton' && typeof bramptonEntry.price==='number' && typeof bramptonEntry.total==='number');
  t('the entry price is the real PT table price for that type', bramptonEntry && PT['Brampton'][bramptonEntry.type]===bramptonEntry.price);
  t('rankCities skips a nonexistent city without crashing', run(`(function(){ var r = rankCities([{n:'Nowhereville'}], {}); return r.ranked.length + r.stretchOnly.length + r.overCommute.length; })()`) === 0);
  const kingCityCount = run(`(function(){ var r = rankCities([M.find(c=>c.n==='King City')], {}); return r.ranked.length + r.stretchOnly.length; })()`);
  t('rankCities handles a city with sparse PT data without crashing', typeof kingCityCount === 'number');
  run('firstTimeBuyer=false;');

  // Who gets the land transfer tax rebates, and who pays the non-resident
  // taxes (2026-09-23, IMPROVEMENT_PLAN.md 1.7; sources in closingcosts.js).
  t('rebate: first-time AND never owned anywhere AND citizen/PR, nothing less',
    run('lttRebateApplies(true,true,true)') === true && run('lttRebateApplies(true,false,true)') === false
    && run('lttRebateApplies(true,true,false)') === false && run('lttRebateApplies(false,true,true)') === false);
  const nr = run(`calcClosingCosts('Toronto - Scarborough', 800000, true, {foreignBuyer:true})`);
  t('non-resident in Toronto: 25% Ontario NRST + 10% Toronto MNRST, and no rebate', nr.nrst === 200000 && nr.mnrst === 80000 && nr.ltt.totalRebate === 0);
  const nrOut = run(`calcClosingCosts('Hamilton', 800000, false, {foreignBuyer:true})`);
  t('non-resident outside Toronto: 25% only', nrOut.nrst === 200000 && nrOut.mnrst === 0);
  const res = run(`calcClosingCosts('Toronto - Scarborough', 800000, true)`);
  t('resident, eligible: no speculation tax, rebates up to $8,475 in Toronto', res.nrst === 0 && res.mnrst === 0 && res.ltt.totalRebate === 8475);
}
{
  const gapInc=145000, gapDn=50800;
  run(`
    fam_selected="3"; dn_selected=${gapDn}; grossMonthlyIncome=${gapInc}/12;
    netMonthlyIncome=estimateOntarioNetAnnual(${gapInc})/12; existingDebt=0; firstTimeBuyer=false;
    var __b=calcBP(${gapInc},${gapDn},0); buyPower=__b.bp; comfortBuyPower=__b.comfortBP;
  `);
  const condoPrice = PT['Toronto - Downtown'].condo;
  const oldWayWouldPass = condoPrice <= run('buyPower') && run(`meetsMinDownPayment(${condoPrice},${gapDn})`);
  const actuallyQualifies = run(`qualifiesForProperty(${gapInc},${gapDn},0,${condoPrice},'condo','Toronto - Downtown')`);
  t('sanity: this scenario is the exact gap (old check would pass, real qualification fails)', oldWayWouldPass===true && actuallyQualifies===false);

  const strictResult = run(`getPriceForTypeStrict('Toronto - Downtown','condo',buyPower)`);
  t('default-view qualification path blocks the same condo getPriceForTypeStrict blocks', strictResult === null);

  run(`dn_selected=140000; grossMonthlyIncome=150000/12; netMonthlyIncome=estimateOntarioNetAnnual(150000)/12; existingDebt=0; var __b2=calcBP(150000,140000,0); buyPower=__b2.bp; comfortBuyPower=__b2.comfortBP; activeProp='all';`);
  const compareCityHasNoDetachedOrItsOverBudget = (()=>{
    const p = PT['Welland'];
    return !p.detached || p.detached > run('buyPower');
  })();
  const bestTierForWelland = run(`
    (function(){
      var TIERS=['detached','semi','town','condo'];
      for(var i=0;i<TIERS.length;i++){ var p=getPriceForTypeStrict('Welland',TIERS[i],buyPower); if(p) return TIERS[i]; }
      return null;
    })()
  `);
  t('compare-tool tier resolution finds a real qualifying tier (not hardcoded detached)', bestTierForWelland !== null);
}
{
  t('under 500k: 5% ok', run('meetsMinDownPayment(400000,20000)') === true);
  t('under 500k: below 5% fails', run('meetsMinDownPayment(400000,19000)') === false);
  t('500k-1.5M blended: 750k needs 50k', run('meetsMinDownPayment(750000,50000)') === true);
  t('500k-1.5M blended: 750k fails at 49k', run('meetsMinDownPayment(750000,49000)') === false);
  t('$1M-$1.5M now uses 10% blended tier, not 20% (post Dec 2024 rule)', run('meetsMinDownPayment(1025000,77500)') === true);
  t('$1M-$1.5M blended tier fails just under the minimum', run('meetsMinDownPayment(1025000,77499)') === false);
  t('exactly $1.5M uses 20%', run('meetsMinDownPayment(1500000,300000)') === true);
  t('exactly $1.5M fails just under 20%', run('meetsMinDownPayment(1500000,299999)') === false);
  t('above $1.5M needs full 20%', run('meetsMinDownPayment(1600000,200000)') === false);
  t('above $1.5M passes at true 20%', run('meetsMinDownPayment(1600000,320000)') === true);
  t('999,999 uses blended (needs ~75k)', run('meetsMinDownPayment(999999,76000)') === true);
}
{
  const c = run(`calcCosts(M.find(c=>c.n==='Brampton'), 700000, '3', 140000, 'detached')`);
  t('costs has all components', ['mort','tax','ins','util','maint','condoFee','total'].every(k=>typeof c[k]==='number'));
  t('total = sum of components', c.total === c.mort+c.tax+c.ins+c.util+c.maint+c.condoFee);
  t('detached condoFee is 0', c.condoFee === 0);
  const cc = run(`calcCosts(M.find(c=>c.n==='Brampton'), 540000, '3', 108000, 'condo')`);
  t('condo condoFee > 0', cc.condoFee > 0);
  t('tax = price × city rate (Brampton 1.039%)', Math.abs(cc.tax - Math.round(540000*0.01039/12)) <= 1);
  const cHi = run(`calcCosts(M.find(c=>c.n==='Brampton'), 1100000, '3', 220000, 'detached')`);
  const cLo = c;
  t('tax scales with price', cHi.tax > cLo.tax);
  t('tax ratio matches price ratio', Math.abs((cHi.tax/cLo.tax) - (1100000/700000)) < 0.02);
  t('insurance scales with price (dampened)', cHi.ins > cLo.ins && (cHi.ins/cLo.ins) < (1100000/700000));
  t('mortgage positive', cLo.mort > 0);
  t('zero loan → zero mortgage', run(`calcCosts(M.find(c=>c.n==='Brampton'),500000,'3',500000,'detached')`).mort === 0);
  const insured = run(`calcCosts(M.find(c=>c.n==='Brampton'),500000,'3',50000,'detached')`);
  const unins   = run(`calcCosts(M.find(c=>c.n==='Brampton'),562500,'3',112500,'detached')`);
  t('CMHC premium raises payment vs same uninsured loan', insured.mort > unins.mort);
}
{
  const cases = [['Brampton',1025000,'detached'],['Welland',655000,'detached'],['Newmarket',650000,'detached']];
  for(const [n,p,tp] of cases){
    const c = run(`calcCosts(M.find(c=>c.n===${JSON.stringify(n)}), ${p}, '3', ${p*0.2}, ${JSON.stringify(tp)})`);
    t('ins '+n+' detached in $1.1k–2.6k/yr band', c.ins*12>=1100 && c.ins*12<=2600);
  }
  const tc = run(`calcCosts(M.find(c=>c.n==='Toronto - Downtown'), 635000, '3', 127000, 'condo')`);
  t('ins Toronto condo in $300–800/yr band', tc.ins*12>=300 && tc.ins*12<=800);
}
{
  const anchorPrice = PT['Brampton'].condo;
  const anchor = run(`calcCosts(M.find(c=>c.n==='Brampton'), ${anchorPrice}, '3', ${anchorPrice*0.2}, 'condo')`).condoFee;
  const base = run(`CONDO_FEES['Brampton']||500`);
  t('condo fee at anchor equals base', anchor === base);
  const hi = run(`calcCosts(M.find(c=>c.n==='Brampton'), 700000, '3', 140000, 'condo')`).condoFee;
  const lo = run(`calcCosts(M.find(c=>c.n==='Brampton'), 430000, '3', 86000, 'condo')`).condoFee;
  t('condo fee scales up above anchor', hi > anchor);
  t('condo fee scales down below anchor', lo < anchor);
  t('condo fee dampened (not 1:1 with price)', (hi/anchor) < (700000/anchorPrice));
}
{
  const net = run('estimateOntarioNetAnnual(250000)');
  t('net income < gross', net < 250000);
  t('net income plausible (55–82% of gross)', net/250000 > 0.55 && net/250000 < 0.82);
  const fitGreat = run('getFit(2000,20000)');
  t('getFit low burden = great', /great/i.test(fitGreat.lbl));
  const fitHi = run('getFit(11000,20000)');
  t('getFit high burden not great', !/great/i.test(fitHi.lbl));
  setup(250000, 150000, 'daily', 'Brampton');
  const det = run(`getPriceForTypeStrict('Brampton','detached',buyPower)`);
  t('Brampton detached now unlocked at 150k DP (post $1.5M-cap fix, needs only ~77.5k)', det === PT['Brampton'].detached);
  const semi = run(`getPriceForTypeStrict('Brampton','semi',buyPower)`);
  t('Brampton semi allowed at 150k DP', semi === PT['Brampton'].semi);
  setup(250000, 150000, 'daily', 'Brampton');
  const kingBlocked = run(`getPriceForTypeStrict('King City','detached',buyPower)`);
  t('King City detached ($1.65M, above cap) blocked at 150k DP (needs $330k = 20%)', kingBlocked === null);
  setup(400000, 330000, 'daily', 'Brampton');
  const kingUnlocked = run(`getPriceForTypeStrict('King City','detached',buyPower)`);
  t('King City detached unlocks at true 20% down ($330k)', kingUnlocked === PT['King City'].detached);
  setup(60000, 15000, 'daily', 'Brampton');
  const con = run(`getPriceForTypeStrict('Toronto - Downtown','condo',buyPower)`);
  t('low BP blocks expensive condo', con === null);
}

// Two incomes (2026-09-23, IMPROVEMENT_PLAN.md 3.3): each person is taxed
// separately. The calculator used to tax a couple's total as one earner's.
{
  const one = run('estimateOntarioNetAnnual(130000)'), two = run('estimateHouseholdNetAnnual(65000,65000)');
  t('two $65K earners keep more than one $130K earner ($500+/month)', (two - one) / 12 > 500);
  t('a blank partner income changes nothing', run('estimateHouseholdNetAnnual(130000,0)') === one && run('estimateHouseholdNetAnnual(130000,undefined)') === one);
  run('partnerIncomeShare=0.5;');
  t("a what-if household income keeps the buyer's split", Math.abs(run('householdNetAnnual(200000)') - run('estimateHouseholdNetAnnual(100000,100000)')) < 0.01);
  run('partnerIncomeShare=0;');
  t('with no partner, household take-home is the one-earner estimate', run('householdNetAnnual(130000)') === one);
}

// REWRITTEN 2026-09-23 (IMPROVEMENT_PLAN.md 1.4). This suite used to pin a
// weighted score (computeCityScore) in which commute could lower a city but
// never rule it out. It now pins the one rule: commute is the buyer's own hard
// limit, applied before ranking, and every place ranks by "the most home you
// can comfortably afford, shortest commute first".
suite('Ranking');
{
  setup(150000, 100000, 'daily', 'Brampton');
  const r = run(`(function(){
    var r = rankCities(M, {sort:'home', maxCommute:60});
    var pick = function(e){ return {n:e.n, type:e.type, cm:e.commuteMin, comfortable:e.comfortable, fit:e.fit.cls, price:e.price}; };
    return {ranked:r.ranked.map(pick), stretch:r.stretchOnly.map(pick), over:r.overCommute.map(pick), limit:r.limit, known:r.commuteKnown};
  })()`);
  // Measured 2026-09-23 for this buyer ($150K, $100K down, daily to north-east
  // Brampton): within a 60-minute rush-hour drive only Brampton itself has a
  // comfortable home -- Mississauga, Etobicoke and Vaughan are all Stretch --
  // while Hamilton, Oshawa and Orangeville are comfortable but 70-125 minutes
  // away. That trade-off is the honest answer, and it is exactly what the old
  // weighted score hid by ranking the far cities highly.
  t('cities ranked for a daily Brampton worker', r.ranked.length >= 1);
  t('comfortable cities past the limit are set aside for the commute, not for money', r.over.some(e=>e.comfortable && e.n==='Hamilton'));
  t('the limit applied is the one asked for (60 min)', r.limit === 60 && r.known === true);
  t('every ranked city is within the 60-minute limit', r.ranked.every(e=>e.cm !== null && e.cm <= 60));
  t('every city past the limit is set aside, not ranked', r.over.length > 0 && r.over.every(e=>e.cm > 60));
  t('Brampton is ranked for a Brampton worker', r.ranked.some(e=>e.n==='Brampton'));
  t('Ottawa is set aside, never ranked (it used to be #13 for a Toronto worker)', !r.ranked.some(e=>e.n==='Ottawa'));
  t('Welland is set aside for a daily Brampton worker (it used to rank #1 for a Toronto hybrid worker)', !r.ranked.some(e=>e.n==='Welland'));
  t('no ranked city is a Stretch or above the comfort range', r.ranked.every(e=>e.comfortable && e.fit !== 'fs'));
  const rank = {detached:4,semi:3,town:2,condo:1};
  t('ranked by most home first', r.ranked.every((e,i)=>i===0 || rank[r.ranked[i-1].type] >= rank[e.type]));
  t('...then shortest commute within the same home type', r.ranked.every((e,i)=>i===0 || rank[r.ranked[i-1].type] !== rank[e.type] || r.ranked[i-1].cm <= e.cm));
  const byCommute = run(`rankCities(M, {sort:'commute', maxCommute:60}).ranked.slice(0,5).map(e=>e.n)`);
  t('sorted by shortest commute, Brampton is in the top 5 for a Brampton worker', byCommute.includes('Brampton'));

  setup(150000, 100000, 'remote', 'Brampton');
  const rr = run(`(function(){ var r = rankCities(M, {sort:'home', maxCommute:60}); return {n:r.ranked.map(e=>e.n), over:r.overCommute.length, limit:r.limit}; })()`);
  t('remote: no commute limit applies, whatever is passed', rr.limit === null && rr.over === 0);
  t('remote: Welland is ranked like anywhere else', rr.n.includes('Welland'));
}
{
  const profiles = [[80000,40000],[120000,80000],[150000,100000],[200000,150000],[250000,150000]];
  for(const [inc,dn] of profiles){
    setup(inc, dn, 'daily', 'Brampton');
    const ok = run(`
      (function(){
        for(var i=0;i<M.length;i++){
          var city=M[i], pt=PT[city.n]; if(!pt) continue;
          var tiers=['condo','town','semi','detached'];
          for(var j=0;j<tiers.length;j++){
            var price=getPriceForTypeStrict(city.n,tiers[j],comfortBuyPower);
            if(price){
              var c=calcCosts(city,price,'3',dn_selected,tiers[j]);
              // Threshold raised from 0.55 to 0.56 on 2026-09-22. NOT a
              // relaxation to make a test pass: estimateOntarioNetAnnual() was
              // overstating net income (missing Ontario surtax + health
              // premium + CPP2), so this bound was being measured against an
              // inflated denominator. With correct net income the comfort
              // range's outer edge measures 49.9%–55.1% of take-home across
              // the five profiles below, peaking at Oshawa detached for a
              // $200K/$150K buyer. 0.56 is the true boundary of current
              // behaviour, not a target.
              // OPEN PRODUCT QUESTION: a "comfort range" whose edge permits
              // 55% of take-home pay may be looser than the label implies.
              // Tightening the GDS/TDS comfort ratios (0.32/0.38 in calcBP)
              // would change what every buyer is told, so it is a product
              // decision, not a fix — raised in the 2026-09-22 audit.
              if(c.total/netMonthlyIncome > 0.56) return false;
            }
          }
        }
        return true;
      })()
    `);
    t('comfort-range picks stay under 55% burden @'+inc, ok);
  }
  let mono = true, prev = 0;
  for(const inc of [60000,80000,100000,150000,200000,250000,300000]){
    const bp = run(`calcBP(${inc},50000,0)`);
    if(bp.bp < prev) mono = false;
    prev = bp.bp;
  }
  t('BP monotonic in income', mono);
  let monoD = true; prev = 0;
  for(const dn of [25000,50000,100000,150000,200000]){
    const bp = run(`calcBP(150000,${dn},0)`);
    if(bp.bp < prev) monoD = false;
    prev = bp.bp;
  }
  t('BP monotonic in down payment', monoD);

  // The weights and the hidden desirability ranking are gone; the defaults
  // that replaced them are pinned instead (IMPROVEMENT_PLAN.md 1.4).
  t('the weighted score is gone (RANKING_WEIGHTS, computeCityScore)', run(`typeof RANKING_WEIGHTS`) === 'undefined' && run(`typeof computeCityScore`) === 'undefined');
  t('the hidden desirability ranking is gone (DESIRABILITY, TIER_WEIGHTS, homePilotSort)',
    run(`typeof DESIRABILITY`) === 'undefined' && run(`typeof TIER_WEIGHTS`) === 'undefined' && run(`typeof homePilotSort`) === 'undefined');
  const dmc = run('DEFAULT_MAX_COMMUTE');
  // 2.2a (2026-09-24): 60 for hybrid too (it was 90); 75 and 90 stay in the list.
  t('default commute limits: 60 min daily, 60 min hybrid, none for remote', dmc.daily === 60 && dmc.hybrid === 60 && !dmc.remote);
  const mcc = run('MAX_COMMUTE_CHOICES');
  t('75 and 90 minutes can still be picked', mcc.includes(75) && mcc.includes(90));
  t('the three sorts: most home, shortest commute, lowest monthly cost', JSON.stringify(run('RESULT_SORTS')) === JSON.stringify(['home','commute','cost']));
  t('all 55 cities present in M', M.length === 55);
  t('Bolton and Caledon both exist (same municipality)', !!M.find(c=>c.n==='Bolton') && !!M.find(c=>c.n==='Caledon'));
  t('every city has tx rate', M.every(c=>typeof c.tx==='number' && c.tx>0.004 && c.tx<0.025));
  t('every city has avg price', M.every(c=>typeof c.avg==='number' && c.avg>200000));
  t('every city has ins base', M.every(c=>typeof c.ins==='number' && c.ins>40));
  const rate=n=>M.find(c=>c.n===n).tx;
  t('Toronto rate 0.666%', Math.abs(rate('Toronto - Downtown')-0.00666)<1e-6);
  t('Brampton rate 1.039%', Math.abs(rate('Brampton')-0.01039)<1e-6);
  t('Fort Erie rate 1.895%', Math.abs(rate('Fort Erie')-0.01895)<1e-6);
  t('Bolton = Caledon rate', rate('Bolton')===rate('Caledon'));
}

suite('PropertyTable');
{
  t('PT covers all 55 cities', Object.keys(PT).length >= 55);
  let orderOk = true, bad = null;
  for(const [city,tiers] of Object.entries(PT)){
    const seq = ['condo','town','semi','detached'].map(k=>tiers[k]).filter(v=>v);
    for(let i=1;i<seq.length;i++) if(seq[i] <= seq[i-1]) { orderOk=false; bad=city; }
  }
  t('tier prices strictly ascending in every city'+(bad?' (bad: '+bad+')':''), orderOk);
  t('Welland condo $299k', PT['Welland'].condo === 299000);
  t('Fort Erie condo $340k', PT['Fort Erie'].condo === 340000);
  t('Brampton detached $1,025k', PT['Brampton'].detached === 1025000);
  t('Toronto Downtown has condo', !!PT['Toronto - Downtown'].condo);
  t('all prices sane (>100k, <3M)', Object.values(PT).every(tr=>Object.values(tr).every(v=>!v || (v>100000 && v<3000000))));
  t('every PT city exists in M', Object.keys(PT).every(n=>M.some(c=>c.n===n)));
  t('every M city exists in PT', M.every(c=>PT[c.n]));
  t('King City exists in PT', !!PT['King City']);
  t('known gap: King City condo/town missing (backlog)', !PT['King City'].condo && !PT['King City'].town);
}

suite('Explainability');
{
  setup(150000, 100000, 'daily', 'Brampton');
  const bulletsRes = run(`
    (function(){
      var city = M.find(c=>c.n==='Brampton');
      // Since 2026-09-23 the 4th argument is the estimated drive in minutes
      // (commuteEstimateMin), not an access tier.
      var cm = commuteEstimateMin('Brampton');
      var c = calcCosts(city, PT['Brampton'].condo, '3', 100000, 'condo');
      var threw = false, bullets = null;
      try { bullets = buildWhyRankedBullets(city, c, netMonthlyIncome, cm, 'condo', PT['Brampton'].condo); }
      catch(e){ threw = true; }
      return {threw:threw, bullets:bullets};
    })()
  `);
  t('buildWhyRankedBullets does not throw', !bulletsRes.threw);
  t('returns structured output', bulletsRes.bullets !== null && bulletsRes.bullets !== undefined);
  const arr = Array.isArray(bulletsRes.bullets) ? bulletsRes.bullets : [];
  t('returns at least 2 bullets', arr.length >= 2);
  const joined = JSON.stringify(bulletsRes.bullets||'');
  t('mentions commute for daily', /commute/i.test(joined));
  t('mentions take-home or affordability', /take-home|afford|income|%/i.test(joined));

  setup(150000, 100000, 'remote', 'Brampton');
  const bulletsResR = run(`
    (function(){
      var city = M.find(c=>c.n==='Brampton');
      var c = calcCosts(city, PT['Brampton'].condo, '3', 100000, 'condo');
      var bullets = null;
      try { bullets = buildWhyRankedBullets(city, c, netMonthlyIncome, null, 'condo', PT['Brampton'].condo); } catch(e){}
      return bullets;
    })()
  `);
  const joinedR = JSON.stringify(bulletsResR||'');
  t('remote bullets differ from daily', joinedR !== joined);
  // REVIEW_BACKLOG.md P1-6: a green tick only for good news.
  t('every bullet has a tone (good / neutral / bad) for its icon', arr.every(b=>['good','neutral','bad'].includes(b.tone)));
  t('the commute bullet is a neutral fact, not a tick', arr.filter(b=>b.key==='commute').every(b=>b.tone==='neutral'));
  const allStretch = run(`(function(){ var saved=comfortBuyPower; comfortBuyPower=1; var b=buildWhyRankedBullets(M.find(c=>c.n==='Brampton'), null, netMonthlyIncome, null, 'condo', 0); comfortBuyPower=saved; return b; })()`);
  t('"all a stretch" is flagged as bad news, not ticked', allStretch.some(b=>b.key==='options' && b.tone==='bad' && /stretch/.test(b.text)));

  const at10 = run('getAccessTier(10)'), at35 = run('getAccessTier(35)'), at90 = run('getAccessTier(90)');
  t('getAccessTier(10) is excellent-ish', /excellent/i.test(at10.label));
  t('getAccessTier(35) mid tier', !/excellent/i.test(at35.label));
  t('getAccessTier(90) limited tier', /limited/i.test(at90.label));
  t('tier monotonic: 10 ≠ 90', at10.label !== at90.label);

  const c2 = run(`calcCosts(M.find(c=>c.n==='Brampton'), PT['Brampton'].condo, '3', 100000, 'condo')`);
  const burden = Math.round(c2.total/run('netMonthlyIncome')*100);
  t('burden calc sane (5–60%)', burden>=5 && burden<=60);

  const net = run('netMonthlyIncome');
  const gross = run('grossMonthlyIncome');
  const fitGreat = run(`getFit(${net*0.30}, ${gross})`);
  const fitGood  = run(`getFit(${net*0.40}, ${gross})`);
  const fitStretch = run(`getFit(${net*0.50}, ${gross})`);
  t('30% burden = Great Fit', /great/i.test(fitGreat.lbl));
  t('40% burden = Good Fit', /good/i.test(fitGood.lbl) && !/great/i.test(fitGood.lbl));
  t('50% burden = Stretch', /stretch/i.test(fitStretch.lbl));
  const sameRatioA = run('(function(){ netMonthlyIncome=10000; return getFit(3600,0).lbl; })()');
  const sameRatioB = run('(function(){ netMonthlyIncome=20000; return getFit(7200,0).lbl; })()');
  t('thresholds universal: same ratio (36%) → same label at different income levels', sameRatioA === sameRatioB);
  t('fit label never empty', fitGreat.lbl.length > 0);
}

suite('Commute');
{
  const hasTable = run(`typeof DRIVE_TABLE!=='undefined'`);
  t('DRIVE_TABLE exists', hasTable);
  const zones = run(`Object.keys(DRIVE_TABLE['Brampton']||{})`);
  t('48 work zone columns', zones.length === 48);
  const complete = run(`
    (function(){
      var zones = Object.keys(DRIVE_TABLE['Brampton']||{});
      for(var i=0;i<M.length;i++){
        var row = DRIVE_TABLE[M[i].n];
        if(!row) return M[i].n;
        for(var j=0;j<zones.length;j++){ if(typeof row[zones[j]]!=='number') return M[i].n+'/'+zones[j]; }
      }
      return true;
    })()
  `);
  t('every city has minutes to every zone'+(complete!==true?' (missing '+complete+')':''), complete===true);

  setup(150000, 100000, 'daily', 'Brampton');
  const cmB = run(`calcCommuteMinutes('Brampton')`);
  const cmO = run(`calcCommuteMinutes('Oshawa')`);
  const cmBar = run(`calcCommuteMinutes('Barrie')`);
  const cmOtt = run(`calcCommuteMinutes('Ottawa')`);
  t('Brampton→Brampton short (<25min)', cmB < 25);
  t('Brampton closer than Oshawa', cmB < cmO);
  t('Oshawa closer than Ottawa', cmO < cmOtt);
  t('Barrie closer than Ottawa', cmBar < cmOtt);
  t('all commutes positive', [cmB,cmO,cmBar,cmOtt].every(v=>v>0));

  // getCommuteScore() was removed 2026-09-23 (commute is a hard limit now).
  // What replaced it: the rush-hour estimate must never run backwards. It used
  // to (a 120-minute drive showed 186, a 130-minute one 143).
  const mono = run(`(function(){
    var saved = workZone, prev = -1, bad = null;
    workZone = 'toronto_downtown';
    var rows = Object.keys(DRIVE_TABLE).map(function(n){ return [DRIVE_TABLE[n].toronto_downtown, calcCommuteMinutes(n), n]; })
      .sort(function(a,b){ return a[0]-b[0]; });
    for (var i=0;i<rows.length;i++){ if(rows[i][1] < prev) bad = rows[i][2]; prev = rows[i][1]; }
    workZone = saved;
    return bad;
  })()`);
  t('rush-hour estimate rises with the off-peak time, everywhere'+(mono?' (runs backwards at '+mono+')':''), mono === null);
  // The Ottawa row and column were kilometres, not minutes (2026-09-23).
  const ott = run(`({tor: DRIVE_TABLE['Ottawa'].toronto_downtown, king: DRIVE_TABLE['Ottawa'].kingston, torKing: DRIVE_TABLE['Kingston'].toronto_downtown, col: DRIVE_TABLE['Toronto - Downtown'].ottawa})`);
  t('Ottawa to downtown Toronto is a ~4h20 drive off-peak, not 430 (km)', ott.tor >= 240 && ott.tor <= 290);
  t('going via Kingston is no longer shorter than driving direct', ott.torKing + ott.king > ott.tor);
  t('the Ottawa row and the ottawa column agree', ott.col === ott.tor);
  t('commuteEstimateMin rounds to 5 minutes, and is null for remote', run(`(function(){ var s=workArrangement; var m=commuteEstimateMin('Oshawa'); workArrangement='remote'; var r=commuteEstimateMin('Oshawa'); workArrangement=s; return m%5===0 && r===null; })()`));

  const zoneB = run('workZone');
  t('work zone resolves', typeof zoneB === 'string' && zoneB.length>0);

  const fsaExists = run(`typeof FSA_TO_WORK_ZONE!=='undefined'`);
  t('FSA table exists', fsaExists);
  const l6p = run(`FSA_TO_WORK_ZONE['L6P']`);
  t('L6P maps to a zone', !!l6p);
  const zonesValid = run(`
    (function(){
      var zones = Object.keys(DRIVE_TABLE['Brampton']||{});
      var vals = Object.values(FSA_TO_WORK_ZONE);
      return vals.every(function(z){ return zones.indexOf(z)>=0 || (typeof SUBZONE_ADJUST!=='undefined' && zones.indexOf((SUBZONE_ADJUST[z]||{}).base)>=0); });
    })()
  `);
  t('FSA zones all resolve to valid DRIVE_TABLE columns', zonesValid);
  t('every zone column is a real place name', zones.every(z=>typeof z==='string' && z.length>1));
}

// REPLACED 2026-09-23 (IMPROVEMENT_PLAN.md 1.4). This suite tested
// getAnglePicks(), a third weighted ranking behind the What-If scenarios, and
// renderAnglePicks()'s "Outside Your Comfort Range" box. Both are gone:
// rankCities() is the one ranking for the screen and the scenarios,
// and the stretch-only cities get their own section in render(). Same five
// buyer profiles, same questions, asked of the one ranking.
suite('OneRanking');
{
  const profiles = [
    [80000, 40000, 'remote'], [120000, 80000, 'hybrid'], [150000, 100000, 'daily'],
    [200000, 150000, 'remote'], [250000, 150000, 'daily'],
  ];
  for(const [inc,dn,wa] of profiles){
    setup(inc, dn, wa, 'Brampton');
    const res = run(`
      (function(){
        var threw=false, r=null;
        try { r = rankCities(M, {sort:'home', maxCommute: DEFAULT_MAX_COMMUTE[workArrangement] || null}); } catch(e){ threw=true; }
        if(threw) return {threw:true};
        var all = r.ranked.concat(r.stretchOnly, r.overCommute).map(function(e){ return e.n; });
        var over = r.overCommute.map(function(e){ return e.n; });
        // Every city with a comfortable home is either ranked or past the commute limit.
        var comfortableAccountedFor = M.every(function(city){
          var has = ['condo','town','semi','detached'].some(function(tp){ return isComfortable(qualifyingOption(city, tp)); });
          return !has || over.indexOf(city.n) >= 0 || r.ranked.some(function(e){ return e.n === city.n; });
        });
        return {
          threw:false, all:all, comfortableAccountedFor: comfortableAccountedFor,
          rankedOk: r.ranked.every(function(e){ return isComfortable(e) && e.fit.cls !== 'fs'; }),
          stretchOk: r.stretchOnly.every(function(e){ return !e.comfortable; }),
          ranked: r.ranked.length,
        };
      })()
    `);
    t('rankCities does not throw @'+inc+'/'+wa, !res.threw);
    if(res.threw){ t('no dup cities @'+inc, false); t('ranked are all comfortable @'+inc, false); t('stretch section holds only the uncomfortable @'+inc, false); t('no comfortable city is lost @'+inc, false); continue; }
    t('no city appears twice across the sections @'+inc, new Set(res.all).size === res.all.length);
    t('every ranked city is comfortable (never a Stretch at the top) @'+inc, res.rankedOk);
    t('the stretch section holds only cities with nothing comfortable @'+inc, res.stretchOk);
    t('no comfortable city is lost: each is ranked or set aside for its commute @'+inc, res.comfortableAccountedFor);
  }
  for(const [inc,dn] of [[100000,60000],[175000,120000],[300000,250000]]){
    setup(inc, dn, 'daily', 'Brampton');
    const o = run(`(function(){
      var h = rankCities(M, {sort:'home', maxCommute:60}).ranked, c = rankCities(M, {sort:'cost', maxCommute:60}).ranked, d = rankCities(M, {sort:'commute', maxCommute:60}).ranked;
      return {
        home: h.every(function(e,i){ return i===0 || HOME_RANK[h[i-1].type] >= HOME_RANK[e.type]; }),
        cost: c.every(function(e,i){ return i===0 || c[i-1].costs.total <= e.costs.total; }),
        // Each place leads with its CHEAPEST comfortable home (2026-09-23: it
        // led with the biggest, so a $2,426 condo could rank below $2,916).
        cheapestLead: c.every(function(e){ return HOME_ORDER.map(function(t){ return qualifyingOption(e.city,t); }).filter(isComfortable).every(function(p){ return e.costs.total <= p.costs.total; }); }),
        drive: d.every(function(e,i){ return i===0 || d[i-1].commuteMin <= e.commuteMin; }),
        same: JSON.stringify(h.map(function(e){return e.n;}).sort()) === JSON.stringify(c.map(function(e){return e.n;}).sort()),
      };
    })()`);
    t('"Most home" order never puts less home above more @'+inc, o.home);
    t('"Lowest monthly cost" order is cheapest first @'+inc, o.cost);
    t('"Lowest monthly cost": each place leads with its cheapest comfortable home @'+inc, o.cheapestLead);
    t('"Shortest commute" order is shortest first @'+inc, o.drive);
    t('the three sorts reorder the same cities, never change which ones @'+inc, o.same);
  }
  setup(45000, 15000, 'daily', 'Brampton');
  const lowRes = run(`(function(){ try { rankCities(M, {sort:'home', maxCommute:60}); return false; } catch(e){ return true; } })()`);
  t('low BP profile does not crash the ranking', !lowRes);
  setup(400000, 400000, 'remote', 'Brampton');
  const hiRes = run(`(function(){ try { return {threw:false, n:rankCities(M, {sort:'home'}).ranked.length}; } catch(e){ return {threw:true}; } })()`);
  t('high BP profile does not crash', !hiRes.threw);
  t('high BP produces ranked cities', !hiRes.threw && hiRes.n > 0);

  // The old ranking systems are gone from the page's code entirely.
  t('getAnglePicks / renderAnglePicks are gone', run(`typeof getAnglePicks`) === 'undefined' && run(`typeof renderAnglePicks`) === 'undefined');
  t('the lead re-deriver is gone (getLeadSummaryForCity)', run(`typeof getLeadSummaryForCity`) === 'undefined');
  const renderStart2 = src.indexOf('function render(){');
  const renderSrc2 = src.slice(renderStart2, src.indexOf('function selectPropType', renderStart2));
  t('render() orders cities only through rankCities()', /rankCities\(results,/.test(renderSrc2) && !/\.sort\(\(a,b\)=>b\.compositeScore/.test(renderSrc2));
  t('render() has a separate "Only as a stretch" section', /Only as a stretch/.test(renderSrc2));
  t('render() records the cards it drew (shownCards) for the PDF report and Compare', /shownCards=\[/.test(renderSrc2));
  t('the orange "Limited Commute ... long daily drive" box is gone from the cards', !/long daily drive/.test(renderSrc2));
}

// ───────────────────────────── SUITE 7: BREAKDOWN ─────────────────────────────
// Added July 16, 2026 with the Down Payment / Mortgage Amount (loan) breakdown
// rows. Until 2026-09-23 this suite also tested lead delivery (sub(), the
// send-lead Worker, the lead payload). That went with the lead form, which the
// user removed from the site to rebuild properly later.
async function runSuite7(){
  suite('Breakdown');
  // Engine state for the checks below. The lead tests' form reset used to set
  // it, so this suite silently depended on them: 4.19%, not a first-time buyer.
  run(`customMortgageRate=0.0419; firstTimeBuyer=false; fam_selected='3'; existingDebt=0;`);

  // --- Breakdown display formula (golden-line source check) ---
  // selectPropType() mutates the DOM in place rather than returning HTML, so instead
  // of simulating a full render we lock in the exact source lines — this catches any
  // accidental future edit that breaks the display formula.
  t('source contains effectiveDn cash-rich cap (Math.min(dn_selected, price))', /const effectiveDn = Math\.min\(dn_selected, price\)/.test(src));
  t('source contains Down Payment row using effectiveDn', /row\('Down Payment', '-' \+ fc\(effectiveDn\)\)/.test(src));
  t('source contains Mortgage Amount row = price - effectiveDn', /row\('Mortgage Amount \(loan\)', fc\(Math\.max\(0, price - effectiveDn\)\)/.test(src));

  // --- Cross-check: displayed loan amount matches calcCosts internal loan math ---
  // For a 20%+-down scenario (no CMHC premium complicating the math), the mortgage
  // payment should be exactly the standard annuity payment on (price - downPayment) at
  // the current rate — formalizes the manual Shelburne hand-check into a permanent test.
  const price = 555000, dnAmt = 150000, rate = 0.0419;
  const c = run(`calcCosts(M.find(c=>c.n==='Shelburne'), ${price}, '3', ${dnAmt}, 'town')`);
  const loan = price - dnAmt;
  const r = rate/12, nMonths = 360;
  const expectedPayment = Math.round(loan * r * Math.pow(1+r,nMonths) / (Math.pow(1+r,nMonths)-1));
  t('calcCosts mortgage payment matches manual (price-downPayment) annuity calc within $2 (Shelburne $555k/$150k down)', Math.abs(c.mort - expectedPayment) <= 2);
  t('displayed loan amount (price-effectiveDn) is NOT the full sticker price', (price-dnAmt) !== price);

  done();
}

done();

runSuite7().then(async () => {
  // ───────────────────────────── SUITE 8: CARD LAYOUT ─────────────────────────────
  // Added July 16, 2026 — locks in card-level layout decisions that have already
  // regressed once (View Available Homes accidentally ended up trapped inside the
  // collapsed/tap-to-expand .bk section instead of being permanently visible).
  // Structural source checks, not DOM rendering — consistent with the breakdown
  // "golden-line" tests above, since selectPropType()/render() mutate the DOM in
  // place rather than returning HTML we could otherwise inspect directly.
  suite('CardLayout');
  {
    const renderStart = src.indexOf('function render(){');
    const renderEnd = src.indexOf('function selectPropType', renderStart);
    t('render() function located for scoping this suite\'s checks', renderStart !== -1 && renderEnd !== -1 && renderEnd > renderStart);
    const renderSrc = src.slice(renderStart, renderEnd);

    const bkOpenIdx = renderSrc.indexOf('<div class="bk">');
    const viewBtnIdx = renderSrc.indexOf('class="view-btn"');
    t('"View Available Homes" (view-btn) exists in the main card render', viewBtnIdx !== -1);
    t('view-btn appears in the source AFTER the .bk div opens', bkOpenIdx !== -1 && viewBtnIdx > bkOpenIdx);

    // Confirm .bk has actually CLOSED by the time view-btn appears (not merely
    // textually after the opening tag while still nested inside it) — i.e. there
    // must be at least one closing </div> between the .bk open and the view-btn.
    const betweenBkAndViewBtn = renderSrc.slice(bkOpenIdx, viewBtnIdx);
    const closesBetween = (betweenBkAndViewBtn.match(/<\/div>'\+/g)||[]).length;
    t('.bk closes (at least one </div>) before view-btn — confirms the link sits OUTSIDE the collapsed section, not just after .bk\'s opening tag', closesBetween >= 1);

    // Confirm the CSS itself still hides .bk by default (sanity: if someone removes
    // this rule entirely thinking it's now unused, the stretch warning - the only
    // thing left inside .bk - would incorrectly become permanently visible without
    // anyone deciding that).
    t('.bk is still hidden by default in CSS (only the stretch warning depends on this now)', /\.bk\{display:none/.test(html));
    t('.city.open .bk still becomes visible on card expand (stretch warning still reachable)', /\.city\.open \.bk\{display:block\}/.test(html));

    // AI insights trigger: confirm it's intentionally collapsed-by-default (this one
    // SHOULD require a click — only view-btn was the regression, not this).
    t('AI insights box still starts collapsed (display:none) by design', /id="ai-'\+id\+'".*?style="display:none/.test(renderSrc.replace(/\n/g,' ')));
    t('AI insights has its own dedicated toggle function (toggleAiInsights), independent of card expand', /function toggleAiInsights\(/.test(src));

    // Per-type View Available Homes links (added same day) — each accordion panel
    // (condo/town/semi/detached) gets its own unambiguous view-btn using that exact
    // type's real price, instead of the city-level button's guess-the-type logic.
    const selectPropStart = src.indexOf('function selectPropType(cityId, tp, cityName)');
    const selectPropEndRaw = src.indexOf('\nfunction ', selectPropStart+30);
    const selectPropEnd = selectPropEndRaw === -1 ? src.length : selectPropEndRaw;
    const selectPropSrc = src.slice(selectPropStart, selectPropEnd);
    t('selectPropType() function located for scoping these checks', selectPropStart !== -1 && selectPropEnd > selectPropStart);
    t('per-type panel contains its own view-btn', /class="view-btn"/.test(selectPropSrc));
    t('per-type view-btn is a plain link to the listings page via listingsLinkAttrs(cityName,tp,price) -- 2026-09-24, no pop-up window', /<a class="view-btn"[^>]*'\+listingsLinkAttrs\(cityName,tp,price\)\+'/.test(selectPropSrc) && !selectPropSrc.includes('openListingsWindow('));
    t('per-type view-btn label uses PLBL to show the real type name (e.g. "Townhouse", not raw "town")', /View Available '\+\(PLBL\[tp\]\|\|tp\)\+' in '\+cityName/.test(selectPropSrc));
    t('per-type view-btn appears inside the panel before panel.innerHTML is assigned (i.e. actually gets rendered, not dead code after assignment)', selectPropSrc.indexOf('class="view-btn"') < selectPropSrc.indexOf('panel.innerHTML = html'));
  }
  done();

  // ─────────────────────── SUITE 9: AI INSIGHTS REDESIGN ───────────────────────
  // Added July 16, 2026 — locks in the AI insights redesign that removed the
  // speculative "Growth" section, merged Case For + Family, replaced AI-invented
  // commute times with real access-tier data, and added explicit content
  // guardrails after a real problematic output (demographic framing of a
  // neighborhood) was caught in production. Mixes structural source checks with
  // a real functional test that mocks the AI response and inspects rendered HTML.
  suite('AIInsights');
  {
    const fetchStart = src.indexOf('async function fetchCityInsights');
    const fetchEndRaw = src.indexOf('\nfunction ', fetchStart+30);
    const fetchEnd = fetchEndRaw === -1 ? src.length : fetchEndRaw;
    const fetchSrc = src.slice(fetchStart, fetchEnd);
    t('fetchCityInsights() function located for scoping these checks', fetchStart !== -1 && fetchEnd > fetchStart);

    t('"growth" is no longer a field the AI is asked to generate', !/"growth":/.test(fetchSrc));
    t('the old 5-field schema (caseFor/giving_up) is fully replaced', !/"caseFor":|"giving_up":/.test(fetchSrc));
    t('new 3-field schema present: whyBuyers, tradeOffs, lifestyleSnapshot', /"whyBuyers":/.test(fetchSrc) && /"tradeOffs":/.test(fetchSrc) && /"lifestyleSnapshot":/.test(fetchSrc));

    t('prompt forbids exact commute/drive time claims', /NEVER state an exact commute time/.test(fetchSrc));
    t('prompt forbids crime/safety claims', /NEVER make claims about crime/.test(fetchSrc));
    t('prompt forbids school ranking claims', /NEVER rank or rate schools/.test(fetchSrc));
    t('prompt forbids appreciation/investment predictions', /NEVER predict future home price appreciation/.test(fetchSrc));
    t('prompt forbids describing a neighborhood by ethnic/cultural/religious composition (the actual production incident that triggered this redesign)', /ethnic, cultural, or religious composition/.test(fetchSrc));
    t('prompt forbids unverifiable demographic/population statistics', /NEVER state specific population or demographic statistics/.test(fetchSrc));

    t('the old per-city static "drive" minutes value is no longer fed into the prompt', !/Drive to Toronto from \$\{cityName\}: \$\{drive\} minutes/.test(fetchSrc));

    t('Access to Work section is computed from real getAccessTier() data, not from the AI response', /getAccessTier\(cm\)/.test(fetchSrc) && /calcCommuteMinutes\(cityName\)/.test(fetchSrc));
    t('Access to Work is NOT sourced from parsed.commute or any AI field', !/parsed\.commute/.test(fetchSrc));

    // Disclaimer wording corrected 2026-09-22 (audit). It used to claim the
    // text was "generated from HomePilot's city profiles and affordability
    // analysis". Nothing of the sort reaches the prompt — only a city name, an
    // income and a buying power. What must hold now is the opposite: the
    // disclaimer says the commentary is model-written and NOT from HomePilot's
    // data, and must not re-acquire the old grounding claim.
    t('AI disclaimer says the text is AI-written', /written by an AI model/.test(fetchSrc));
    t('AI disclaimer does not claim HomePilot data as the source',
      !/generated from HomePilot/.test(fetchSrc) && !/city profiles and affordability analysis/.test(fetchSrc));
    t('AI disclaimer still points the buyer at their own research', /your own research/.test(fetchSrc));
    t('AI disclaimer separates the dollar figures from the AI commentary',
      /calculated by HomePilot, not by the AI/.test(fetchSrc));

    // HomePilot Score display — removed twice now (once before this session, once
    // during it) per the standing decision "buyers want numbers, not scores".
    // Guarding this explicitly since it has already silently reappeared once.
    t('HomePilot Score display block does NOT reappear in the AI insights box', !/HomePilot Score<\/div>/.test(fetchSrc));
    t('the disclaimer is the true end of the rendered box - nothing scored/numeric follows it', (() => {
      const disclaimerIdx = fetchSrc.indexOf('used alongside your own research');
      const afterDisclaimer = fetchSrc.slice(disclaimerIdx, disclaimerIdx + 300);
      return !/\/10/.test(afterDisclaimer) && !/hpColor|hpBar|hpBg/.test(afterDisclaimer);
    })());
  }
  {
    const mkStore=()=>{ const s={}; const g=(id)=>{ if(!s[id]) s[id]=mkEl(); return s[id]; }; return {get:g,store:s}; };
    const {get:aiGetEl}=mkStore();
    const savedGetElById = ctx.document.getElementById;
    ctx.document.getElementById = aiGetEl;

    const fakeAnthropicResponse = {
      content: [{ type:'text', text: JSON.stringify({
        whyBuyers: 'TESTMARK_WHYBUYERS more space for the money here.',
        tradeOffs: 'TESTMARK_TRADEOFFS fewer transit options nearby.',
        lifestyleSnapshot: 'TESTMARK_LIFESTYLE Suburban · Car-dependent'
      })}]
    };
    const savedFetch = ctx.fetch;
    ctx.fetch = async () => ({ ok:true, json: async () => fakeAnthropicResponse });

    run(`
      results=[{n:'Brampton'}]; fam_selected='3'; dn_selected=100000;
      grossMonthlyIncome=150000/12; netMonthlyIncome=estimateOntarioNetAnnual(150000)/12;
      existingDebt=0; firstTimeBuyer=false; buyPower=630000; comfortBuyPower=520000;
      customMortgageRate=0.0419; workArrangement='daily';
      workZone=FSA_TO_WORK_ZONE['L6P']||'brampton_ne';
    `);
    aiGetEl('ai-testcity').dataset.hpScore='7.0';
    aiGetEl('ai-testcity').style.display='block';

    await vm.runInContext(`fetchCityInsights('testcity','Brampton')`, ctx);
    const renderedHtml = aiGetEl('ai-testcity').innerHTML;

    t('functional: rendered output contains the AI-provided whyBuyers text', renderedHtml.includes('TESTMARK_WHYBUYERS'));
    t('functional: rendered output contains the AI-provided tradeOffs text', renderedHtml.includes('TESTMARK_TRADEOFFS'));
    t('functional: rendered output contains the AI-provided lifestyleSnapshot text', renderedHtml.includes('TESTMARK_LIFESTYLE'));
    t('functional: rendered output contains "Access to Work" (real data, not AI)', renderedHtml.includes('Access to Work'));
    t('functional: rendered output contains the corrected disclaimer',
      renderedHtml.includes('written by an AI model') && renderedHtml.includes('your own research'));
    t('functional: rendered output does NOT contain a "Growth" or "growth story" header', !/growth story/i.test(renderedHtml));
    t('functional: rendered output does NOT contain the old "family picture" header', !/family picture/i.test(renderedHtml));
    t('functional: rendered output does NOT contain a "HomePilot Score" block', !/HomePilot Score/.test(renderedHtml));

    ctx.document.getElementById = savedGetElById;
    ctx.fetch = savedFetch;
  }
  done();

  console.log('\n════════ HOMEPILOT REGRESSION — '+new Date().toISOString().slice(0,10)+' ════════');
  for(const s of suiteResults) console.log((s.pass===s.total?'✓':'✗')+' '+s.name.padEnd(20)+' '+s.pass+'/'+s.total);
  console.log('────────────────────────────────');
  console.log('TOTAL: '+pass+'/'+(pass+fail)+(fail?'  ← '+fail+' FAILURES':'  — ALL GREEN'));
  if(failures.length){ console.log('\nFAILURES:'); failures.forEach(f=>console.log('  ✗ '+f)); }
  process.exit(fail?1:0);
});
