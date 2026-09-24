// tests/worth_knowing_test.js
// Unit tests for HomePilot Worth Knowing and the "you're close" empty page
// (src/worth-knowing.js; IMPROVEMENT_PLAN.md 2.2 "Worth Knowing" and 2.0).
//
// Every tip is a claim about what the engine would say if one answer were
// different: "Save $25,000 more and a condo in Toronto - Scarborough just fits
// your HomePilot comfort range: $545,000 at 44% of take-home". Each claim is
// checked here by running the calculator's own search, go(), again with that
// answer changed, and reading rankCities() -- never by trusting the module's
// own re-run. "Smallest" is checked the same way, one $5,000 step below, and
// "you're close" by trying every step up to the caps.
//
// Deterministic and offline: the calculator page's scripts run in a vm with a
// stand-in document (the same harness as tests/engine_invariants_test.js), so
// it needs no server and no network.
// Run: node tests/worth_knowing_test.js calculator.html

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
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, innerHTML: '', textContent: '',
  value: '', dataset: {}, querySelectorAll() { return []; }, querySelector() { return mkEl(); },
  scrollIntoView() {}, focus() {}, disabled: false,
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
  Error, Promise, Set, Map, localStorage: { getItem() { return null; }, setItem() {} },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);
const data = (code) => JSON.parse(run('JSON.stringify(' + code + ')'));

let pass = 0, fail = 0;
const fails = [];
const t = (name, ok, detail) => {
  if (ok) pass++;
  else { fail++; fails.push(name + (detail !== undefined ? ' :: ' + detail : '')); }
};

const C = data('({ STEP: WK_STEP, SAVE: WK_SAVE_CAP, EARN: WK_EARN_CAP, DRIVE: WK_DRIVE_CAP_MIN, SAVING: WK_DRIVE_MIN_SAVING, MONTHLY: WK_DRIVE_MIN_MONTHLY, LINE: WK_STRETCH_LINE_PCT, JUST: WK_JUST_FITS_PTS, MAX: WK_MAX_TIPS, FAR_SAVE: WK_FAR_SAVE_CAP, FAR_EARN: WK_FAR_EARN_CAP })');
const HOME_RANK = data('HOME_RANK');

// ── The page's own search, go(), for a buyer ────────────────────────────
// b: { income, partner, down, debt, firstTime, work, workCity, limit (minutes, or 'none'), onlyType }
function search(b) {
  byId('inc').value = String(b.income);
  byId('inc2').value = b.partner ? String(b.partner) : '';
  byId('dwn').value = String(b.down);
  byId('dbt').value = String(b.debt || 0);
  byId('fam').value = '3';
  byId('area').value = 'all';
  byId('workCity').value = b.workCity || 'Toronto';
  byId('workPostal').value = '';
  run(`maxCommuteTouched=false; setFTB(${b.firstTime === true}); setWorkArrangement(${JSON.stringify(b.work)});`);
  if (b.limit !== undefined) run(`setMaxCommute(${JSON.stringify(String(b.limit))})`);
  run('go();');
  run(`activeProp=${JSON.stringify(b.onlyType || 'all')}; render();`);
}
const onlyTypeJs = "(activeProp!=='all'?activeProp:null)";
// What render() worked with, and HomePilot Worth Knowing for it.
const pageRanking = (limitJs) => data(`(function(){ var r = rankCities(results,{sort:'home',maxCommute:${limitJs || 'maxCommuteMin'},onlyType:${onlyTypeJs}});
  var f = function(e){ return { n:e.n, type:e.type, price:e.price, monthly:Math.round(e.costs.total), pct:e.pct, fit:e.fit.lbl, commuteMin:e.commuteMin, comfortable:e.comfortable }; };
  return { ranked:r.ranked.map(f), stretchOnly:r.stretchOnly.map(f), overCommute:r.overCommute.map(f), limit:r.limit, commuteKnown:r.commuteKnown }; })()`);
const wkNow = () => data(`worthKnowing(answerPicks(results,{maxCommute:maxCommuteMin,onlyType:${onlyTypeJs}}),${onlyTypeJs})`);
const picksNow = () => data(`answerPicks(results,{maxCommute:maxCommuteMin,onlyType:${onlyTypeJs}}).picks.map(function(p){ var e=p.entry; return { n:e.n, type:e.type, price:e.price, monthly:Math.round(e.costs.total), commuteMin:e.commuteMin, answers:p.answers }; })`);
const sameHome = (a, b) => !!a && !!b && a.n === b.n && a.type === b.type && a.price === b.price && a.monthly === b.monthly && a.pct === b.pct && a.fit === b.fit;
const text = (h) => String(h || '').replace(/<[^>]+>/g, '');
const fc = (n) => run(`fc(${n})`);
const justFits = (pct) => pct >= C.LINE - C.JUST;
// The % as a tip words it: a home that fits but rounds to the Stretch line
// (44.9% shows as 45%) is "just under 45%", so it does not read as a Stretch
// card's 45%.
const pctWords = (c) => (c.pct >= C.LINE && c.fit !== 'Stretch' ? 'just under ' + C.LINE : c.pct) + '% of take-home';
// The buyer with one answer changed, as they would type it: more down
// payment, or more income typed into ONE box, the one the tip names: the
// higher earner's ("Your income" when the two are equal). Until 2026-09-24
// the tip split the raise in the couple's proportion without saying so, and
// this helper split it evenly; neither is what a buyer would type.
const changed = (b, lever, x) => {
  if (lever === 'save') return { ...b, down: b.down + x };
  if (b.partner && b.partner > b.income) return { ...b, partner: b.partner + x };
  return { ...b, income: b.income + x };
};
// What an earn tip must say about whose income it raises.
const earnWhose = (b) => !b.partner ? '(before tax)' : b.partner > b.income ? "(before tax, added to your partner's income)" : '(before tax, added to your income)';

// ── The buyers ──────────────────────────────────────────────────────────
// The plan's worked example (2.0): a couple on $65K + $65K, $70K down,
// hybrid, working in Toronto, first-time buyers, $450/month debt; at the
// 60-minute default and at the 90 minutes the plan used. The rest cover
// every kind of page: tips on the normal page, the empty page with tips in
// reach, with only far-off answers, and with none; remote buyers; savings
// as the limit.
const BUYERS = [
  { tag: 'worked example, 60 min', income: 65000, partner: 65000, down: 70000, debt: 450, firstTime: true, work: 'hybrid', limit: 60 },
  { tag: 'worked example, 90 min', income: 65000, partner: 65000, down: 70000, debt: 450, firstTime: true, work: 'hybrid', limit: 90 },
  { tag: '$250K daily, $300K down', income: 250000, down: 300000, firstTime: false, work: 'daily', limit: 60 },
  { tag: '$180K hybrid, $120K down', income: 180000, down: 120000, debt: 450, firstTime: true, work: 'hybrid', limit: 60 },
  { tag: '$200K remote, $20K down (savings the limit)', income: 200000, down: 20000, firstTime: false, work: 'remote' },
  { tag: '$140K remote, $80K down', income: 140000, down: 80000, firstTime: true, work: 'remote' },
  { tag: '$90K daily, $80K down', income: 90000, down: 80000, firstTime: true, work: 'daily', limit: 60 },
  { tag: '$70K daily, $15K down', income: 70000, down: 15000, firstTime: true, work: 'daily', limit: 60 },
  { tag: '$90K remote, $40K down', income: 90000, down: 40000, firstTime: true, work: 'remote' },
  { tag: '$70K remote, $15K down', income: 70000, down: 15000, firstTime: true, work: 'remote' },
  { tag: 'worked example, detached only', income: 65000, partner: 65000, down: 70000, debt: 450, firstTime: true, work: 'hybrid', limit: 60, onlyType: 'detached' },
  { tag: '$150K daily in Brampton', income: 150000, down: 100000, firstTime: true, work: 'daily', workCity: 'Brampton', limit: 60 },
  // Two unequal incomes: an earn tip holds only for the split it names.
  { tag: '$150K + $60K hybrid Markham', income: 150000, partner: 60000, down: 150000, debt: 800, firstTime: false, work: 'hybrid', workCity: 'Markham', limit: 60 },
  { tag: '$150K + $60K hybrid Markham, detached only', income: 150000, partner: 60000, down: 150000, debt: 800, firstTime: false, work: 'hybrid', workCity: 'Markham', limit: 60, onlyType: 'detached' },
  { tag: '$60K + $150K hybrid Markham (partner earns more)', income: 60000, partner: 150000, down: 150000, debt: 800, firstTime: false, work: 'hybrid', workCity: 'Markham', limit: 60 },
];

// The drive rule for the normal page, written out again from the plan and run
// on the page as it is: from an answer card, a place further out but within
// the limit, the same or a bigger home type, comfortable, at most
// WK_DRIVE_CAP_MIN more minutes, cheaper by WK_DRIVE_MIN_SAVING or
// WK_DRIVE_MIN_MONTHLY a month (and cheaper on both). Strongest: the least of
// (extra minutes / cap) / (how many times over the minimum saving).
const driveSpec = () => data(`(function(){
  var ot = ${onlyTypeJs}, types = ot ? [ot] : HOME_ORDER;
  var a = answerPicks(results, {maxCommute:maxCommuteMin, onlyType:ot});
  if (!a.byHome.commuteKnown) return null;
  var best = null;
  a.picks.forEach(function(p){ var ref = p.entry; if (ref.commuteMin === null) return;
    a.byHome.ranked.forEach(function(c){
      if (c.n === ref.n || c.commuteMin === null) return;
      var extra = c.commuteMin - ref.commuteMin; if (extra <= 0 || extra > ${C.DRIVE}) return;
      types.forEach(function(t){
        if (HOME_RANK[t] < HOME_RANK[ref.type]) return;
        var o = qualifyingOption(c.city, t); if (!isComfortable(o)) return;
        var s = ref.price - o.price, mo = Math.round(ref.costs.total - o.costs.total);
        if (!(s > 0 && mo > 0) || (s < ${C.SAVING} && mo < ${C.MONTHLY})) return;
        var eff = (extra / ${C.DRIVE}) / Math.max(s / ${C.SAVING}, mo / ${C.MONTHLY});
        if (!best || eff < best.eff || (eff === best.eff && HOME_RANK[t] > HOME_RANK[best.type])) best = { eff: eff, n: c.n, type: t, from: ref.n, fromType: ref.type };
      });
    });
  });
  return best;
})()`);
const driveMatches = (wk) => {
  const spec = driveSpec(), tip = wk.levers.find((x) => x.kind === 'drive');
  return spec === null ? !tip : !!tip && tip.claim.n === spec.n && tip.claim.type === spec.type && tip.claim.from.n === spec.from && tip.claim.from.type === spec.fromType;
};

const seen = { normalTips: 0, emptyClose: 0, emptyFar: 0, emptyNothing: 0, kinds: new Set(), justFits: 0, notJust: 0, savings: 0, earnSplit: 0, justUnder: 0 };
const worked = {};

// 0. The thresholds are the app's own lines.
{
  const lines = data(`(function(){ var s = netMonthlyIncome; netMonthlyIncome = 10000;
    var r = [getFit(${(C.LINE / 100) * 10000 - 1}).cls, getFit(${(C.LINE / 100) * 10000}).cls]; netMonthlyIncome = s; return r; })()`);
  t('WK_STRETCH_LINE_PCT is getFit()\'s Stretch line (just under it: Good Fit; at it: Stretch)', lines[0] === 'fo' && lines[1] === 'fs', lines.join(','));
  const jf = data('[40, 42, 43, 44, 45].map(wkJustFits)');
  t('"just fits" from 43% of take-home up (within 2 points of the 45% Stretch line), not below', jf.join(',') === 'false,false,true,true,true', jf.join(','));
  t('the caps are named, positive and in $5,000 steps', C.STEP === 5000 && C.SAVE > 0 && C.SAVE % C.STEP === 0 && C.EARN > 0 && C.EARN % C.STEP === 0
    && C.FAR_SAVE > C.SAVE && C.FAR_EARN > C.EARN && C.DRIVE > 0 && C.SAVING > 0 && C.MONTHLY > 0 && C.MAX === 2, JSON.stringify(C));
}

for (const b of BUYERS) {
  const tag = b.tag;
  search(b);
  const base = pageRanking();
  const picks = picksNow();
  run('_wkCache = null;');
  const globalsJs = '[grossMonthlyIncome, netMonthlyIncome, dn_selected, existingDebt, buyPower, comfortBuyPower, customMortgageRate, workArrangement, workZone, maxCommuteMin]';
  const before = data(globalsJs);
  const wk = wkNow();
  t(`(${tag}) worthKnowing() puts every page global back`, JSON.stringify(data(globalsJs)) === JSON.stringify(before));
  run('_wkCache = null;');
  t(`(${tag}) deterministic: the same answers give the same tips, word for word`, JSON.stringify(wkNow()) === JSON.stringify(wk));
  t(`(${tag}) render() drew exactly this: #worthKnowing is worthKnowingHtml()`, byId('worthKnowing').innerHTML === run(`worthKnowingHtml(worthKnowing(answerPicks(results,{maxCommute:maxCommuteMin,onlyType:${onlyTypeJs}}),${onlyTypeJs}))`));

  // The module's engine run with nothing changed IS the page's ranking.
  const zero = data(`(function(){ var r = wkRun(wkBase(${onlyTypeJs}), {}).ranking;
    var f = function(e){ return { n:e.n, type:e.type, price:e.price, monthly:Math.round(e.costs.total), pct:e.pct, fit:e.fit.lbl, commuteMin:e.commuteMin, comfortable:e.comfortable }; };
    return { ranked:r.ranked.map(f), stretchOnly:r.stretchOnly.map(f), overCommute:r.overCommute.map(f), limit:r.limit, commuteKnown:r.commuteKnown }; })()`);
  t(`(${tag}) wkRun() with no change gives the page's own ranking, place for place`, JSON.stringify(zero) === JSON.stringify(base));

  t(`(${tag}) empty exactly when nothing within the limit fits`, wk.empty === (base.ranked.length === 0));
  t(`(${tag}) the heading is "HomePilot Worth Knowing"`, !wk.tips.length && !wk.empty ? byId('worthKnowing').innerHTML === '' : /<div class="wk-title">HomePilot Worth Knowing<\/div>/.test(byId('worthKnowing').innerHTML));

  const all = wk.tips.concat(wk.far);
  // Wording: the brand, never a bare "comfort range", never "comfortably afford".
  t(`(${tag}) the wording always says "HomePilot comfort range", never a bare "comfort range" or "comfortably afford"`,
    all.every((x) => !/comfortably afford/i.test(x.html) && (text(x.html).match(/comfort range/g) || []).length === (text(x.html).match(/HomePilot comfort range/g) || []).length));

  // The savings tip: calcBP()'s own figures for the HomePilot comfort range,
  // first whenever savings cap it (2026-09-24: it pointed at the bank's
  // ceiling, and showed when savings capped only the bank's figure).
  const calc = data(`calcBP(${b.income + (b.partner || 0)}, ${b.down}, ${b.debt || 0})`);
  const savingsApplies = calc.comfortDownPaymentLimited && calc.comfortDownPaymentShortfall > 0 && calc.comfortIncomeCapBP > calc.comfortBP;
  if (savingsApplies) seen.savings++;
  t(`(${tag}) the savings tip is there exactly when savings cap the HomePilot comfort range, and it is first, in the plan's words`,
    savingsApplies ? wk.tips[0] && wk.tips[0].kind === 'savings-limit' && wk.tips[0].claim.comfortCapBP === calc.comfortIncomeCapBP && wk.tips[0].claim.moreSaved === calc.comfortDownPaymentShortfall
      && text(wk.tips[0].html) === `Your savings are the limit, not your income. On your income alone your HomePilot comfort range would be ${fc(calc.comfortIncomeCapBP)}; about ${fc(calc.comfortDownPaymentShortfall)} more saved would get you there.`
      : !all.some((x) => x.kind === 'savings-limit'), JSON.stringify(wk.tips.map((x) => x.kind)));
  if (savingsApplies) {
    // Searching again with that much more saved gets the HomePilot comfort range there.
    search(changed(b, 'save', calc.comfortDownPaymentShortfall));
    const got = data('comfortBuyPower');
    t(`(${tag}) savings tip: searching again with ${fc(calc.comfortDownPaymentShortfall)} more saved, the HomePilot comfort range is ${fc(calc.comfortIncomeCapBP)} or more`,
      got >= calc.comfortIncomeCapBP, got);
    search(b);
  }

  // No drive tip without a commute.
  if (b.work === 'remote') t(`(${tag}) remote: no drive tip`, !all.some((x) => x.kind === 'drive'));
  // An earn tip says whose income it raises when there are two, so the buyer
  // can type exactly the search it was worked out on.
  const earns = wk.levers.concat(all).filter((x) => x.kind === 'earn');
  if (earns.length) seen.earnSplit += b.partner && b.partner !== b.income ? 1 : 0;
  t(`(${tag}) every earn tip says "${earnWhose(b)}"`, earns.every((x) => text(x.html).includes('more a year ' + earnWhose(b) + ' and ')), earns.map((x) => text(x.html)).join(' | '));

  if (!wk.empty) {
    // ── The normal page ──
    const levers = wk.tips.filter((x) => x.kind !== 'savings-limit');
    if (wk.tips.length) seen.normalTips++;
    t(`(${tag}) normal page: at most ${C.MAX} tips, the savings tip first, the rest strongest first`,
      wk.tips.length <= C.MAX && wk.tips.every((x, i) => x.kind !== 'savings-limit' || i === 0) && levers.every((x, i) => i === 0 || levers[i - 1].effort <= x.effort),
      JSON.stringify(wk.tips.map((x) => x.kind + ':' + x.effort)));
    t(`(${tag}) normal page: no "you're close" and nothing far-off`, !wk.close && !wk.far.length);
    t(`(${tag}) normal page: the tips shown are the savings tip, then the strongest of the levers worth showing, two at most`,
      JSON.stringify(wk.tips) === JSON.stringify(wk.tips.filter((x) => x.kind === 'savings-limit').concat(wk.levers).slice(0, C.MAX)));
    t(`(${tag}) normal page: the drive tip is the one the rule picks (or none when nothing passes it)`, driveMatches(wk), JSON.stringify(driveSpec()));
    // The places the answers show, with the most home each has today.
    const places = [];
    picks.forEach((p) => { if (!places.some((x) => x.n === p.n)) places.push({ n: p.n, type: base.ranked.find((e) => e.n === p.n).type }); });
    for (const tip of levers) {
      seen.kinds.add(tip.kind);
      const c = tip.claim;
      if (tip.kind === 'save' || tip.kind === 'earn') {
        const cap = tip.kind === 'save' ? C.SAVE : C.EARN;
        t(`(${tag}) ${tip.kind}: within the cap, in $5,000 steps`, c.extra > 0 && c.extra <= cap && c.extra % C.STEP === 0, c.extra);
        search(changed(b, tip.kind, c.extra));
        const after = pageRanking().ranked.find((e) => e.n === c.n);
        const from = places.find((p) => p.n === c.n);
        t(`(${tag}) ${tip.kind} ${fc(c.extra)}: searching again with it, ${c.n} really has a bigger home that fits, exactly as the tip says`,
          !!from && sameHome(after, c) && after.comfortable && HOME_RANK[after.type] > HOME_RANK[from.type] && c.fromType === from.type, JSON.stringify(after) + ' vs ' + JSON.stringify(c));
        search(changed(b, tip.kind, c.extra - C.STEP));
        const lower = pageRanking().ranked;
        t(`(${tag}) ${tip.kind}: and it is the smallest step: ${fc(c.extra - C.STEP)} upgrades no answer place`,
          places.every((p) => { const e = lower.find((x) => x.n === p.n); return !e || HOME_RANK[e.type] <= HOME_RANK[p.type]; }));
        t(`(${tag}) ${tip.kind}: "just fits" exactly when the % lands within ${C.JUST} points of the Stretch line`,
          c.justFits === justFits(c.pct) && /just fits/.test(tip.html) === justFits(c.pct) && text(tip.html).includes(pctWords(c)));
        if (justFits(c.pct)) seen.justFits++; else seen.notJust++;
        search(b);
      } else if (tip.kind === 'drive') {
        const ref = picks.find((p) => p.n === c.from.n && p.type === c.from.type);
        const opt = data(`(function(){ var city = results.find(function(x){ return x.n === ${JSON.stringify(c.n)}; }); var o = qualifyingOption(city, ${JSON.stringify(c.type)});
          return o && { price:o.price, monthly:Math.round(o.costs.total), comfortable:isComfortable(o), commuteMin:commuteEstimateMin(city.n) }; })()`);
        t(`(${tag}) drive: from an answer card, its home as shown`, !!ref && ref.price === c.from.price && ref.monthly === c.from.monthly && ref.commuteMin === c.from.commuteMin);
        t(`(${tag}) drive: ${c.n}'s ${c.type} is comfortable at that price and monthly cost, within the limit`,
          !!opt && opt.comfortable && opt.price === c.price && opt.monthly === c.monthly && opt.commuteMin === c.commuteMin && base.ranked.some((e) => e.n === c.n)
            && (base.limit === null || c.commuteMin <= base.limit), JSON.stringify(opt));
        t(`(${tag}) drive: same or bigger home, a short extra drive, a big saving`,
          HOME_RANK[c.type] >= HOME_RANK[c.from.type] && c.extra === c.commuteMin - c.from.commuteMin && c.extra > 0 && c.extra <= C.DRIVE
            && c.saving === c.from.price - c.price && c.monthlySaving === c.from.monthly - c.monthly && c.saving > 0 && c.monthlySaving > 0
            && (c.saving >= C.SAVING || c.monthlySaving >= C.MONTHLY), JSON.stringify(c));
        t(`(${tag}) drive: the words carry the engine's numbers`, text(tip.html).includes(`${c.extra} more minutes to ${c.n}`) && text(tip.html).includes(`${fc(c.saving)} less than in ${c.from.n}`)
          && text(tip.html).includes(`about ${c.commuteMin} min each way`));
      }
    }
  } else {
    // ── The empty page ──
    const levers = wk.tips.filter((x) => x.kind !== 'savings-limit');
    const drivePast = base.commuteKnown && base.limit !== null ? base.overCommute.filter((e) => e.comfortable) : [];
    const nearest = drivePast.length ? drivePast.reduce((a, e) => (e.commuteMin < a.commuteMin ? e : a)) : null;
    // Close rests on the caps; once close, the drive tip shows at any distance
    // (2026-09-24: the plan's example names places 100 and 110 minutes out).
    t(`(${tag}) empty page: "you're close" exactly when a save, drive or earn tip is within the caps`,
      wk.close === levers.some((x) => x.kind !== 'drive' || x.extra <= C.DRIVE) && (wk.close || !levers.length));
    t(`(${tag}) empty page: when close, a drive tip whenever a place past the limit fits (the nearest), at any distance`,
      !wk.close || (!!nearest === levers.some((x) => x.kind === 'drive')));
    t(`(${tag}) empty page: one tip per lever at most, in the order save, drive, earn`,
      levers.map((x) => x.kind).join(',') === ['save', 'drive', 'earn'].filter((k) => levers.some((x) => x.kind === k)).join(','));
    const heading = run(`wkEmptyHeading(worthKnowing(answerPicks(results,{maxCommute:maxCommuteMin,onlyType:${onlyTypeJs}}),${onlyTypeJs}))`);
    const what = b.onlyType ? 'No ' + data('WK_TYPE')[b.onlyType] : 'Nothing';
    t(`(${tag}) the heading: "${what}${base.limit !== null ? ' within ' + base.limit + ' minutes' : ''} fits your HomePilot comfort range yet${wk.close ? ", but you're close." : '.'}"`,
      text(heading) === what + (base.limit !== null ? ' within ' + base.limit + ' minutes' : '') + ' fits your HomePilot comfort range yet' + (wk.close ? ", but you're close." : '.')
        && text(byId('cnt').innerHTML) === text(heading), text(byId('cnt').innerHTML));
    const verifyFirstFit = (tip, lever, from) => {
      const c = tip.claim;
      search(changed(b, lever, c.extra));
      const after = pageRanking();
      t(`(${tag}) ${lever} ${fc(c.extra)}: searching again with it, ${c.n} fits as the tip says, and ${c.places} place(s) in all`,
        sameHome(after.ranked[0], c) && after.ranked[0].comfortable && after.ranked.length === c.places, JSON.stringify(after.ranked[0]) + ' vs ' + JSON.stringify(c));
      if (c.extra - C.STEP >= from) {
        search(changed(b, lever, c.extra - C.STEP));
        t(`(${tag}) ${lever}: the smallest step: at ${fc(c.extra - C.STEP)} nothing within the limit fits`, pageRanking().ranked.length === 0);
      }
      t(`(${tag}) ${lever}: "just fits" exactly when the % lands within ${C.JUST} points of the Stretch line, and the % reads "${pctWords(c)}"`, c.justFits === justFits(c.pct) && /just fits/.test(tip.html) === justFits(c.pct) && text(tip.html).includes(pctWords(c)));
      if (c.pct >= C.LINE) seen.justUnder++;
      if (justFits(c.pct)) seen.justFits++; else seen.notJust++;
      search(b);
    };
    for (const tip of levers) {
      seen.kinds.add(tip.kind);
      if (tip.kind === 'save' || tip.kind === 'earn') {
        t(`(${tag}) ${tip.kind}: within the cap`, tip.claim.extra <= (tip.kind === 'save' ? C.SAVE : C.EARN) && tip.claim.extra % C.STEP === 0);
        verifyFirstFit(tip, tip.kind, C.STEP);
      } else {
        const c = tip.claim;
        search({ ...b, limit: 'none' });
        const open = pageRanking();
        t(`(${tag}) drive: with no commute limit, ${c.n} fits as the tip says, ${c.extra} minutes past the ${base.limit}-minute limit`,
          sameHome(open.ranked.find((e) => e.n === c.n), c) && c.commuteMin - base.limit === c.extra && c.extra > 0, JSON.stringify(c));
        t(`(${tag}) drive: it is the nearest place past the limit that fits`, !!nearest && nearest.commuteMin === c.commuteMin);
        search(b);
      }
    }
    // Not close: nothing within the caps, checked step by step.
    if (!wk.close) {
      let anySave = false, anyEarn = false;
      for (let x = C.STEP; x <= C.SAVE; x += C.STEP) { search(changed(b, 'save', x)); if (pageRanking().ranked.length) anySave = true; }
      for (let x = C.STEP; x <= C.EARN; x += C.STEP) { search(changed(b, 'earn', x)); if (pageRanking().ranked.length) anyEarn = true; }
      search(b);
      t(`(${tag}) not close, and rightly: no $5,000 step up to ${fc(C.SAVE)} saved or ${fc(C.EARN)} earned fits, and nothing fits within ${C.DRIVE} minutes past the limit`,
        !anySave && !anyEarn && (!nearest || nearest.commuteMin - base.limit > C.DRIVE));
      t(`(${tag}) not close: the box says what would change the answer, or that no single change did`,
        wk.far.length ? /What would change the answer/.test(byId('worthKnowing').innerHTML) : wk.nothingFar && /No single change we tried/.test(byId('worthKnowing').innerHTML));
      for (const tip of wk.far) {
        if (tip.kind === 'save' || tip.kind === 'earn') {
          t(`(${tag}) far ${tip.kind}: past the cap, within ${fc(tip.kind === 'save' ? C.FAR_SAVE : C.FAR_EARN)}`, tip.claim.extra > (tip.kind === 'save' ? C.SAVE : C.EARN) && tip.claim.extra <= (tip.kind === 'save' ? C.FAR_SAVE : C.FAR_EARN));
          verifyFirstFit(tip, tip.kind, (tip.kind === 'save' ? C.SAVE : C.EARN) + C.STEP);
        } else {
          t(`(${tag}) far drive: the nearest place past the limit that fits, more than ${C.DRIVE} minutes past it`, !!nearest && nearest.commuteMin === tip.claim.commuteMin && tip.claim.extra > C.DRIVE);
        }
      }
      if (wk.far.length) seen.emptyFar++; else seen.emptyNothing++;
    } else seen.emptyClose++;
  }
  if (b.tag.startsWith('worked example, ') && !b.onlyType) worked[b.limit] = { cnt: text(byId('cnt').innerHTML), tips: all.map((x) => text(x.html)), kinds: all.map((x) => x.kind).join(',') };
}

// The drive rule on many more buyers: commuters to five work cities at a
// range of incomes and savings, and remote buyers, who never get one.
{
  let normal = 0, withDrive = 0, bad = [], remoteBad = [];
  for (const workCity of ['Toronto', 'Brampton', 'Mississauga', 'Markham', 'Oakville']) {
    for (const income of [120000, 160000, 220000, 300000]) {
      for (const down of [60000, 150000, 300000]) {
        const b = { income, down, firstTime: true, work: income % 40000 ? 'daily' : 'hybrid', workCity, limit: 60 };
        search(b);
        const wk = wkNow();
        if (wk.empty) {
          const base = pageRanking(), d = wk.levers.concat(wk.far).find((x) => x.kind === 'drive');
          const fits = base.overCommute.filter((e) => e.comfortable);
          const nearest = fits.length ? Math.min(...fits.map((e) => e.commuteMin)) : null;
          // Empty page: the nearest place past the limit that fits, whenever there is
          // one (in the tips when close, in "what would change the answer" when not).
          if (d ? d.claim.commuteMin !== nearest : nearest !== null) bad.push(workCity + ' ' + income + '/' + down + ' (empty)');
          continue;
        }
        normal++;
        if (wk.levers.some((x) => x.kind === 'drive')) withDrive++;
        if (!driveMatches(wk)) bad.push(workCity + ' ' + income + '/' + down);
      }
    }
  }
  for (const income of [90000, 150000, 250000]) for (const down of [40000, 150000]) {
    search({ income, down, firstTime: false, work: 'remote' });
    const wk = wkNow();
    if (wk.levers.concat(wk.tips, wk.far).some((x) => x.kind === 'drive')) remoteBad.push(income + '/' + down);
  }
  t(`the drive rule holds for ${normal} more commuters' normal pages (${withDrive} with a drive tip) and their empty pages`, !bad.length && withDrive > 0, bad.join('; '));
  t('remote buyers never get a drive tip', !remoteBad.length, remoteBad.join('; '));
}

// The buyer's own take-home: a save tip is worked out on it, not the estimate.
{
  const b = BUYERS[0];
  search(b);
  byId('takeHomeInput').value = '7000';
  run('applyTakeHome();');
  const net = data('netMonthlyIncome');
  run('_wkCache = null;');
  const wk = wkNow();
  const save = wk.tips.find((x) => x.kind === 'save');
  t('own take-home: the tips use it (the page is on $7,000/mo)', net === 7000);
  if (save) {
    search(changed(b, 'save', save.claim.extra));
    const after = pageRanking();
    t('own take-home: searching again with the extra savings (same incomes, so the own take-home stays) gives the tip\'s home and %',
      data('netMonthlyIncome') === 7000 && sameHome(after.ranked[0], save.claim), JSON.stringify(after.ranked[0]) + ' vs ' + JSON.stringify(save.claim));
  } else {
    t('own take-home: on $7,000/mo the save tip moves past the cap and the page says so', !wk.close || wk.tips.some((x) => x.kind === 'drive'));
  }
  t('own take-home: no earn tip, and none looked for (a search with another income goes back to the estimate)',
    wk.earnTried === false && !wk.levers.concat(wk.tips, wk.far).some((x) => x.kind === 'earn'), JSON.stringify(wk.tips.map((x) => x.kind)));
  run('resetTakeHome();');
}

// The buyer's own take-home, many buyers: "you're close" and every tip must be
// what the page shows when the buyer searches again with the change. An earn
// tip used to scale the buyer's own figure, which a search again never does
// (go() drops it when an income changes): for $120K, $60K down and $7,773/mo it
// said "Earn $20,000 more ... a Good Fit at 42%" and "you're close", and the
// page at $140K showed that condo at 47%, Stretch.
{
  let pages = 0, closeOnes = 0, bad = [];
  for (const workCity of ['Toronto', 'Mississauga', 'Brampton']) for (const income of [80000, 95000, 120000, 150000]) for (const down of [40000, 60000, 100000]) for (const k of [0.9, 1.1, 1.2]) {
    const b = { income, down, firstTime: true, work: 'daily', workCity, limit: 60 };
    search(b);
    const own = Math.round(data('estimatedNetMonthlyIncome') * k);
    byId('takeHomeInput').value = String(own);
    run('applyTakeHome(); _wkCache = null;');
    if (data('netMonthlyIncome') !== own) { bad.push(`${workCity} ${income}/${down} x${k}: own take-home not applied`); continue; }
    const wk = wkNow();
    pages++;
    const tag = `${workCity} ${income}/${down} x${k}`;
    if (wk.levers.concat(wk.tips, wk.far).some((x) => x.kind === 'earn')) bad.push(tag + ': an earn tip on the buyer\'s own take-home');
    if (wk.empty && wk.close) {
      closeOnes++;
      for (const tip of wk.levers) {
        if (tip.kind === 'save') {
          search(changed(b, 'save', tip.claim.extra));
          const after = pageRanking();
          if (data('netMonthlyIncome') !== own || !sameHome(after.ranked[0], tip.claim) || after.ranked.length !== tip.claim.places) bad.push(tag + ': save tip is not what the page shows');
          search(b);
        }
      }
    }
    run('resetTakeHome();');
  }
  t(`own take-home over ${pages} buyers (${closeOnes} "you're close"): no earn tip, and every save tip is what the page shows when searching again`, pages > 0 && !bad.length, bad.slice(0, 5).join('; '));
}

// The rate slider changes monthly costs, not buying power; the engine run
// with no change still gives the page's ranking.
{
  search(BUYERS[2]);
  run("syncRate('5.5','input');");
  const page = pageRanking();
  const zero = data(`(function(){ var r = wkRun(wkBase(null), {}).ranking; return r.ranked.map(function(e){ return e.n+'|'+e.type+'|'+e.price+'|'+Math.round(e.costs.total)+'|'+e.pct; }); })()`);
  t('rate slider moved: wkRun() with no change still gives the page\'s ranking (buying power from the search\'s rate, costs at the slider\'s)',
    JSON.stringify(zero) === JSON.stringify(page.ranked.map((e) => e.n + '|' + e.type + '|' + e.price + '|' + e.monthly + '|' + e.pct)));
  run("syncRate(String(DEFAULT_MORTGAGE_RATE_PCT),'input');");
}

// The heading without a limit, and with a home-type filter.
t('heading without a commute limit drops "within N minutes"', text(run("wkEmptyHeading({limit:null,onlyType:null,close:true})")) === "Nothing fits your HomePilot comfort range yet, but you're close.");
t('heading with a home type picked names it', text(run("wkEmptyHeading({limit:60,onlyType:'semi',close:false})")) === 'No semi-detached home within 60 minutes fits your HomePilot comfort range yet.');
t('the normal page with no tip worth showing draws nothing', run("worthKnowingHtml({empty:false,tips:[],far:[],close:false})") === '');

// Every kind of page and tip was exercised.
t('covered: tips on the normal page, the empty page close, far off, and with no answer at all',
  seen.normalTips > 0 && seen.emptyClose > 0 && seen.emptyFar > 0 && seen.emptyNothing > 0, JSON.stringify({ ...seen, kinds: [...seen.kinds] }));
t('covered: a buyer whose savings cap the HomePilot comfort range', seen.savings > 0, seen.savings);
t('covered: a tip whose home fits at a % that rounds to the Stretch line ("just under 45%")', seen.justUnder > 0, seen.justUnder);
t('covered: an earn tip for a couple with unequal incomes, checked by searching again with the raise in the box it names', seen.earnSplit > 0, seen.earnSplit);
t('covered: save, drive and earn tips, "just fits" and not', ['save', 'drive', 'earn'].every((k) => seen.kinds.has(k)) && seen.justFits > 0 && seen.notJust > 0,
  JSON.stringify([...seen.kinds]) + ' just ' + seen.justFits + ' not ' + seen.notJust);

// The plan's worked example (2.0): one tip for each lever, save, drive and
// earn, at the 60-minute default as at 90. At 60 the drive tip is Oshawa, 40
// minutes past the limit; it was left out until 2026-09-24.
t('worked example: save, drive and earn tips at 60 minutes and at 90', !!worked[60] && !!worked[90]
  && worked[60].kinds === 'save,drive,earn' && worked[90].kinds === 'save,drive,earn', JSON.stringify([worked[60] && worked[60].kinds, worked[90] && worked[90].kinds]));
console.log('=== HomePilot Worth Knowing: the worked example (IMPROVEMENT_PLAN.md 2.0) ===');
for (const lim of [60, 90]) {
  if (!worked[lim]) continue;
  console.log(`  ${lim}-minute limit: ${worked[lim].cnt}`);
  worked[lim].tips.forEach((x) => console.log('    - ' + x));
}
console.log(`=== Worth Knowing unit tests: ${pass} passed, ${fail} failed ===`);
fails.forEach((f) => console.log('  FAIL - ' + f));
process.exit(fail ? 1 : 0);
