// main.js — HomePilot core application state and orchestration
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules) — the final piece of the split, alongside
// render.js. Pure relocation — no logic changed, no values changed. Loaded
// via <script src="src/main.js"></script> before the main inline script
// (which now only contains markup, the <style> block, some intentionally
// unused/deprecated tables kept for reference, and the final
// loadScenarioFromURL() init call), same shared global scope as before.
//
// Contains: RF (region filter mapping), the core mutable application state
// (results, buyPower, comfortBuyPower, fam_selected, dn_selected,
// grossMonthlyIncome, netMonthlyIncome, customMortgageRate, firstTimeBuyer,
// existingDebt, activeProp, activeFit, devMode, workArrangement, workZone,
// maxCommuteMin, resultsSort, showOverCommute, shownCards),
// checkRequiredChoices() / showFirstUnansweredChoice() (the two questions with
// no pre-selected answer), setWorkArrangement(), setMaxCommute(),
// syncFormLines() / openFormField() / openWorkPostalIfSet() (the one-line
// settings of the shorter form, 2.3a), setResultsSort(), toggleOverCommute(),
// amortizationNote(), the top section of the results (renderTopSection(), the
// take-home the buyer can replace, "How we calculated this"; 2.2), and go() —
// the main calculation orchestrator that runs when the buyer submits the form.

const RF={all:null,gta:["gta"],west:["west"],east:["east"],north:["north"],duff:["duff"],niag:["niag"],wloo:["wloo"],east2:["east2"]};
let results=[],buyPower=0,comfortBuyPower=0,fam_selected="3",dn_selected=0,grossMonthlyIncome=0,netMonthlyIncome=0,customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100,firstTimeBuyer=null,existingDebt=0;

let activeProp='all',activeFit='all',devMode=false;

// No silent defaults (2026-09-24, IMPROVEMENT_PLAN.md 2.5, REVIEW_BACKLOG.md
// P1-9). firstTimeBuyer and workArrangement start as null, "not answered":
// the form used to arrive with "No" and "Remote" already picked, so a buyer
// who skipped them got results built on answers they never gave (a 25-year
// mortgage instead of 30, no commute limit). go() now stops until both are
// answered; see checkRequiredChoices() below.
let workArrangement = null;
let workZone = null;
const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'daily'];

// Commute limit, result order and the on-screen record (added 2026-09-23,
// IMPROVEMENT_PLAN.md 1.2 / 1.4 -- see ranking.js):
//   maxCommuteMin     -- longest one-way drive the buyer accepts, in minutes;
//                        null = no limit. Defaults per work style
//                        (DEFAULT_MAX_COMMUTE) until the buyer picks one.
//   maxCommuteTouched -- true once the buyer has picked, so switching work
//                        style no longer overrides their choice.
//   resultsSort       -- 'home' | 'commute' | 'cost' (RESULT_SORTS): the order
//                        of "See all places" (2026-09-24; it was the order of
//                        the whole list, set by a switch above it).
//   seeAllOpen        -- the buyer opened "See all places" (render.js). Closed
//                        by default, and again on every new search.
//   showOverCommute   -- the buyer asked to see the cities past their limit.
//   shownCards        -- the cards render() last drew, in screen order. The
//                        PDF report (report.js) and Compare (compare.js) are
//                        built from this, so they show exactly what the buyer
//                        saw (REVIEW_BACKLOG.md P0-3).
let maxCommuteMin = null, maxCommuteTouched = false, resultsSort = 'home', seeAllOpen = false, showOverCommute = false, shownCards = [];

// Two answers the land transfer tax depends on (added 2026-09-23,
// IMPROVEMENT_PLAN.md 1.7; the rules and their sources are in closingcosts.js):
//   lttRebateConfirmed -- the buyer ticked "neither I nor my spouse has ever
//                         owned a home, anywhere in the world". Off until
//                         they do, so no rebate is shown to someone who
//                         owned a home abroad. Since 2026-09-24 (2.3a D) the
//                         box sits in the cash-to-close breakdown on the
//                         results, not on the form (costPanelHtml(),
//                         render.js).
//   canadianResident   -- citizen or permanent resident. When false, the
//                         non-resident speculation taxes apply, the rebates
//                         don't, and the results say most non-Canadians
//                         cannot buy yet. Since 2026-09-24 (2.3a E) it is
//                         the form's "I'm not a Canadian citizen or
//                         permanent resident" box, ticked = false.
// Neither travels in a shared link: the share service keeps seven fields
// (scenario-share.js), so whoever opens one starts from these defaults.
let lttRebateConfirmed = false, canadianResident = true;
function buyerLttRebateApplies(){ return lttRebateApplies(firstTimeBuyer, lttRebateConfirmed, canadianResident); }

// Two incomes (added 2026-09-23, IMPROVEMENT_PLAN.md 3.3). Lenders qualify a
// couple on their incomes added together, so buying power uses the total.
// Take-home pay is taxed person by person (estimateHouseholdNetAnnual() in
// utils.js). partnerIncomeShare is the second earner's share of the total,
// so a what-if household income (scenario-sandbox.js) keeps the same split.
let partnerIncomeShare = 0;
function householdNetAnnual(total){ return estimateHouseholdNetAnnual(total*(1-partnerIncomeShare), total*partnerIncomeShare); }

// Take-home: the estimate, or the buyer's own figure (2026-09-24,
// IMPROVEMENT_PLAN.md 2.2, "Estimated take-home"). The estimate subtracts only
// income tax, CPP, EI and the health premium, so it can't know about a
// workplace pension, benefit premiums or union dues (real pay lower) or the
// Canada Child Benefit (higher). "Change it" in the top section lets the buyer
// type their actual monthly take-home, both people together.
//   estimatedNetMonthlyIncome -- householdNetAnnual(income) / 12 for the last search.
//   takeHomeOverride          -- null, or { monthly, own, partner }: the buyer's
//                                figure and the two incomes it was given for.
//   netMonthlyIncome          -- the one figure in force: the buyer's own when
//                                given, else the estimate. Every "% of
//                                take-home" and every Great / Good / Stretch
//                                label reads it (getFit(), rankCities(), the
//                                cards, the breakdowns, the report, Compare,
//                                Scenarios, and the listing pages through the
//                                handover in buyer-profile.js). calcBP() never
//                                does: buying power is on income before tax, as
//                                a bank's is, so the HomePilot comfort range and
//                                the bank's figure do not move.
// A new search keeps the buyer's figure while both incomes are the same, and
// goes back to the estimate when either changes.
let estimatedNetMonthlyIncome = 0, takeHomeOverride = null;
function takeHomeIsBuyersOwn(){ return !!takeHomeOverride; }
// The take-home to use for a household income of `total` a year. The What-If
// scenarios try other incomes: there the buyer's own figure is scaled by how
// the estimate changes, so a buyer whose real pay is 10% under the estimate
// stays 10% under it. For their own income it is exactly their figure.
function takeHomeMonthlyFor(total){
  const est = householdNetAnnual(total) / 12;
  if(!takeHomeOverride || !(estimatedNetMonthlyIncome > 0)) return est;
  return takeHomeOverride.monthly * est / estimatedNetMonthlyIncome;
}
// Checks a typed monthly take-home: positive, and not more than income before
// tax. Returns { value } or { error }.
function checkTakeHome(raw, grossMonthly){
  const v = parseFloat(String(raw === null || raw === undefined ? '' : raw).replace(/[$,\s]/g, ''));
  if(!Number.isFinite(v) || v <= 0) return { error: 'Enter your monthly take-home pay: what reaches your bank account each month.' };
  if(v > grossMonthly) return { error: "That's more than your income before tax (" + fc(grossMonthly) + '/mo). Enter what reaches your bank account each month.' };
  return { value: v };
}
// The two income boxes, read the same way by go(), the share link and the
// debt warning. The partner box is optional: blank means 0.
function readIncomes(){
  const own=parseFloat(document.getElementById('inc').value)||0;
  const el2=document.getElementById('inc2');
  const partner=el2?(parseFloat(el2.value)||0):0;
  return { own, partner, total: own+partner };
}

// The two questions with no pre-selected answer. checkRequiredChoices() shows
// the message under each one still unanswered (and hides it once answered);
// it returns true when both are answered. showFirstUnansweredChoice() brings
// the first of them into view, because the button sits at the bottom of a
// long form.
function hasWorkArrangement(){ return WORK_ARRANGEMENTS.includes(workArrangement); }
function hasFirstTimeAnswer(){ return firstTimeBuyer === true || firstTimeBuyer === false; }
function showChoiceError(id, show){
  const el = document.getElementById(id);
  if(el) el.style.display = show ? 'block' : 'none';
}
function checkRequiredChoices(){
  const waOk = hasWorkArrangement(), ftbOk = hasFirstTimeAnswer();
  showChoiceError('wa_err', !waOk);
  showChoiceError('ftb_err', !ftbOk);
  return waOk && ftbOk;
}
function showFirstUnansweredChoice(){
  const card = document.getElementById(!hasWorkArrangement() ? 'workArrangementCard' : !hasFirstTimeAnswer() ? 'ftbCard' : '');
  if(!card) return;
  if(typeof card.scrollIntoView === 'function') card.scrollIntoView({behavior:'smooth', block:'center'});
  if(!hasWorkArrangement()){
    const sel = document.getElementById('waSelect');
    if(sel && typeof sel.focus === 'function') sel.focus({preventScroll:true});
  }
}

function setWorkArrangement(type) {
  // Only the three real answers; anything else (the "Choose one" placeholder,
  // a bad shared link) leaves the question unanswered.
  if(!WORK_ARRANGEMENTS.includes(type)) return;
  workArrangement = type;
  showChoiceError('wa_err', false);
  const sel = document.getElementById('waSelect');
  if(sel && sel.value !== type) sel.value = type;
  const fields = document.getElementById('workLocationFields');
  const hint = document.getElementById('wa_hint');
  if(!maxCommuteTouched) maxCommuteMin = DEFAULT_MAX_COMMUTE[type] || null;
  syncMaxCommuteSelect();
  if(type === 'remote') {
    if(fields) fields.style.display = 'none';
    if(hint) hint.textContent = 'Remote workers get recommendations ranked purely by affordability.';
  } else {
    if(fields) fields.style.display = 'flex';
    if(hint) hint.textContent = 'Places past your longest commute are set aside, not ranked. Drive times are estimates.';
    openWorkPostalIfSet();
  }
  workZone = null;
  if(results.length) render();
}

// Sets the commute-limit select, and the one line that stands for it, to
// maxCommuteMin.
function syncMaxCommuteSelect() {
  const sel = document.getElementById('maxCommute');
  if(sel) sel.value = maxCommuteMin ? String(maxCommuteMin) : 'none';
  syncFormLines();
}

// The "Longest commute you'd accept (one way)" select. Takes effect on the
// results already on screen.
function setMaxCommute(value) {
  const n = parseInt(value, 10);
  maxCommuteMin = MAX_COMMUTE_CHOICES.includes(n) ? n : null;
  maxCommuteTouched = true;
  showOverCommute = false;
  syncFormLines();
  if(results.length) render();
}

// ── Shorter form (2026-09-24, IMPROVEMENT_PLAN.md 2.3a A, B, C) ──────────
// The commute limit and the preferred area each start as one line ("Showing
// places within 60 minutes · change", "All areas · change"), and the work
// postal code as a link under the work city. Nothing was taken out: "change"
// and "+ add postal code" open the same select or box as before, and go()
// reads them exactly as it did.
//
// syncFormLines() writes what is in force into the two lines. It runs
// whenever the limit or the area can change: setMaxCommute(),
// syncMaxCommuteSelect() (the work-style default, go(), a shared link), the
// area select's own change, and go().
function commuteLimitLine(min){
  return min ? 'Showing places within ' + min + ' minutes' : 'Showing places with no commute limit';
}
function syncFormLines(){
  const cl = document.getElementById('maxCommuteLineText');
  if(cl) cl.textContent = commuteLimitLine(maxCommuteMin);
  const al = document.getElementById('areaLineText');
  const area = document.getElementById('area');
  if(al && area){
    const opt = area.options && area.selectedIndex >= 0 ? area.options[area.selectedIndex] : null;
    al.textContent = !area.value || area.value === 'all' ? 'All areas' : (opt ? opt.textContent : area.value);
  }
}
// Swaps a one-line stand-in (lineId) for the field it stands for (fieldId)
// and puts the cursor in it (controlId).
function openFormField(lineId, fieldId, controlId){
  const line = document.getElementById(lineId), field = document.getElementById(fieldId);
  if(line) line.style.display = 'none';
  if(field) field.style.display = 'block';
  const control = document.getElementById(controlId);
  if(control && typeof control.focus === 'function') control.focus();
}
// A postal code that is already there (a shared link, the browser restoring
// the form, a test) is shown, never used unseen.
function openWorkPostalIfSet(){
  const postal = document.getElementById('workPostal');
  if(!postal || !String(postal.value || '').trim()) return;
  const field = document.getElementById('workPostalField'), add = document.getElementById('workPostalAdd');
  if(field) field.style.display = 'block';
  if(add) add.style.display = 'none';
}
// The browser can put back a typed postal code or a chosen area on reload or
// Back without telling the page.
if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
  window.addEventListener('pageshow', function(){ openWorkPostalIfSet(); syncFormLines(); });
}

// The "Sort by" inside "See all places" (2026-09-24; it was a switch above the
// whole list). It orders the places there; the three answer cards above stay
// as they are, so only "See all places" is drawn again.
function setResultsSort(sort) {
  resultsSort = RESULT_SORTS.includes(sort) ? sort : 'home';
  if(results.length) renderSeeAll();
}

// "Show them" / "Hide them" on the note about cities past the commute limit.
// Their section is inside "See all places", so "Show them" opens it.
function toggleOverCommute() {
  showOverCommute = !showOverCommute;
  if(showOverCommute) seeAllOpen = true;
  if(results.length) render();
}

// The cities a search considers: those in the buyer's chosen area whose entry
// price (M's `min`) is within the bank's ceiling. Shared by go() and the
// What-If scenarios so both start from the same list.
function candidateCities(area, bp) {
  const rf=RF[area],seen=new Set();
  return M.filter(m=>{if(seen.has(m.n))return false;seen.add(m.n);if(rf&&!rf.includes(m.r))return false;return m.min<=bp;});
}

// The rate note under the buying power. It said "25-year amortization
// (30-year available at 20%+ down)" for everyone, but first-time buyers are
// calculated on 30 years at any down payment (mortgage.js), so their note
// contradicted their own numbers (REVIEW_BACKLOG.md P1-10). It now names the
// amortization actually used.
function amortizationNote(isFirstTimeBuyer) {
  return isFirstTimeBuyer
    ? '30-year amortization (first-time buyer)'
    : '25-year amortization, or 30-year on homes where your down payment is 20% or more';
}

// ── The top section (2026-09-24, IMPROVEMENT_PLAN.md 2.2) ──────────────────
// One number, the HomePilot comfort range, then one small line each, as the
// user decided:
//   Your HomePilot comfort range / $520,000 / Stay here to breathe financially
//   A bank might lend up to $630,000, but above your HomePilot comfort range is stretch territory.
//   Based on $130,000/yr ($65,000 + $65,000) · $70,000 down · $450/mo debt
//   Estimated take-home: $8,097/mo · Know your actual pay? Change it
//   Estimate only, not a pre-approval · How we calculated this
// It showed buying power, the bank's maximum and the comfort range, often all
// the same figure. Every figure is calcBP()'s, householdNetAnnual()'s or the
// buyer's own, so none is worked out a second way.
//
// lastSearch: the last search's answers and its calcBP() result, so the top
// section can be drawn again when the take-home changes (and, later, so
// HomePilot Worth Knowing can read the savings tip below).
let lastSearch = null, takeHomeEditOpen = false;

// The bank's figure and the HomePilot comfort range are both rounded to the
// nearest $10,000, so within $10,000 they are the same figure.
const SAME_FIGURE_WITHIN = 10000;

// The one small line under the number. When the down payment is what caps
// the buyer and the bank's figure is the same, that is the news; otherwise it
// names the bank's figure, once.
function comfortBankLine(calc){
  const gap = calc.bp - calc.comfortBP;
  if(calc.downPaymentLimited && gap <= SAME_FIGURE_WITHIN) return 'Your savings are the limit, not your income. A bank would lend the same.';
  // Heavy debt can hold both figures down to the down payment alone.
  if(gap <= 0) return 'A bank would lend about the same.';
  return 'A bank might lend up to ' + fc(calc.bp) + ', but above your HomePilot comfort range is stretch territory.';
}

// "Based on $130,000/yr ($65,000 + $65,000) · $70,000 down · no debt". One
// income: no brackets.
function basedOnLine(s){
  return 'Based on ' + fc(s.total) + '/yr' + (s.partner > 0 ? ' (' + fc(s.own) + ' + ' + fc(s.partner) + ')' : '') +
    ' · ' + fc(s.dn) + ' down · ' + (s.dbt > 0 ? fc(s.dbt) + '/mo debt' : 'no debt');
}

// "Your savings are the limit… $X more saved would get you there": what income
// alone would let a bank lend, and how much more down payment that price needs
// (calcBP()'s incomeCapBP and downPaymentShortfall). null when savings are not
// what holds the buyer back. It is to become the first HomePilot Worth Knowing
// tip; until that section exists the top section shows it, as it did before.
function savingsLimitTip(calc){
  if(!calc || !calc.downPaymentLimited || !(calc.downPaymentShortfall > 0) || !(calc.incomeCapBP > calc.bp)) return null;
  return { incomeCapBP: calc.incomeCapBP, moreSaved: calc.downPaymentShortfall };
}

function renderTopSection(){
  const s = lastSearch;
  if(!s) return;
  const calc = s.calc;
  const bpv = document.getElementById('bpV');
  if(bpv) bpv.textContent = fc(calc.comfortBP);
  const sub = document.getElementById('bpSub');
  if(!sub) return;
  const both = s.partner > 0;
  const takeHome = takeHomeIsBuyersOwn()
    ? 'Your take-home: ' + fc(netMonthlyIncome) + '/mo · <button type="button" class="link-btn" id="takeHomeReset" onclick="resetTakeHome()">reset to estimate</button>'
    : 'Estimated take-home: ' + fc(estimatedNetMonthlyIncome) + '/mo · Know your actual pay? <button type="button" class="link-btn" id="takeHomeChange" onclick="openTakeHomeEdit()" aria-expanded="' + takeHomeEditOpen + '" aria-controls="takeHomeEdit">Change it</button>';
  const tip = savingsLimitTip(calc);
  sub.innerHTML =
    '<div class="bp-line" id="bpBankLine">' + comfortBankLine(calc) + '</div>' +
    '<div class="bp-line" id="bpBasedOn">' + basedOnLine(s) + '</div>' +
    '<div class="bp-line" id="takeHomeLine">' + takeHome + '</div>' +
    // "Change it": the buyer's actual monthly take-home, inline.
    '<div class="bp-inner" id="takeHomeEdit" style="display:' + (takeHomeEditOpen ? 'block' : 'none') + '">' +
      '<label for="takeHomeInput">Your actual monthly take-home' + (both ? ', both of you together' : '') + '</label>' +
      '<div class="bp-takehome-row">' +
        '<input type="number" id="takeHomeInput" min="1" step="1" inputmode="numeric" placeholder="' + Math.round(estimatedNetMonthlyIncome) + '"' +
          ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyTakeHome();}else if(event.key===\'Escape\'){closeTakeHomeEdit();}">' +
        '<button type="button" class="bp-apply-btn" onclick="applyTakeHome()">Use this</button>' +
        '<button type="button" class="link-btn" onclick="closeTakeHomeEdit()">Cancel</button>' +
      '</div>' +
      '<div class="err" id="takeHomeErr" role="alert"></div>' +
    '</div>' +
    // Savings-gap note (added 2026-09-22). Its heading ("Your savings are the
    // limit here, not your income") went with the 2026-09-24 top section: the
    // line above says so when the bank would lend the same, and the note
    // reads on its own when it doesn't.
    (tip
      ? '<div class="bp-inner" id="savingsTip" style="border-left:3px solid rgba(255,255,255,0.55)">' +
          '<div style="font-size:12px;opacity:0.9;line-height:1.5">On your income you could qualify for up to <b>' + fc(tip.incomeCapBP) + '</b>. ' +
          'A home at that price needs a larger down payment than you have — about <b>' + fc(tip.moreSaved) + ' more saved</b> would get you there.</div>' +
        '</div>'
      : '') +
    // Non-residents (added 2026-09-23, IMPROVEMENT_PLAN.md 1.7). The federal
    // ban on non-Canadians buying homes runs until January 1, 2027, with
    // exceptions (e.g. work-permit holders with 183+ days left; CMHC,
    // checked 2026-09-23). Ontario's 25% NRST and Toronto's 10% MNRST are
    // added to cash to close in each city's breakdown.
    (canadianResident === false
      ? '<div class="bp-inner" id="nonResidentNote" style="border-left:3px solid rgba(255,255,255,0.55)">' +
          '<div style="font-size:12px;font-weight:700;margin-bottom:3px">If you\'re not a Canadian citizen or permanent resident</div>' +
          '<div style="font-size:12px;opacity:0.9;line-height:1.5">Most non-Canadians can\'t buy a home in Canada until at least January 1, 2027 (a federal ban). Some are exempt — for example, many work-permit holders with at least 183 days left on their permit. ' +
          'If you can buy, Ontario charges a 25% non-resident speculation tax on the price, plus 10% in Toronto; it\'s included in each city\'s cash to close below, though some buyers are exempt or can get it back. ' +
          'Lenders also treat non-residents differently, so the figures above may be too high. Speak to a real estate lawyer before you make an offer.</div>' +
        '</div>'
      : '');
}

// "Change it" / "Cancel" on the take-home line.
function openTakeHomeEdit(){
  takeHomeEditOpen = true;
  const box = document.getElementById('takeHomeEdit');
  if(box) box.style.display = 'block';
  const btn = document.getElementById('takeHomeChange');
  if(btn) btn.setAttribute('aria-expanded', 'true');
  const input = document.getElementById('takeHomeInput');
  if(input && typeof input.focus === 'function') input.focus();
}
function closeTakeHomeEdit(){
  takeHomeEditOpen = false;
  const box = document.getElementById('takeHomeEdit');
  if(box) box.style.display = 'none';
  const err = document.getElementById('takeHomeErr');
  if(err) err.style.display = 'none';
  const btn = document.getElementById('takeHomeChange');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}
// Uses the typed take-home for everything that reads netMonthlyIncome.
function applyTakeHome(){
  if(!lastSearch) return;
  const input = document.getElementById('takeHomeInput');
  const r = checkTakeHome(input ? input.value : '', grossMonthlyIncome);
  if(r.error){
    const err = document.getElementById('takeHomeErr');
    if(err){ err.textContent = r.error; err.style.display = 'block'; }
    if(input && typeof input.focus === 'function') input.focus();
    return;
  }
  takeHomeOverride = { monthly: r.value, own: lastSearch.own, partner: lastSearch.partner };
  netMonthlyIncome = r.value;
  takeHomeEditOpen = false;
  takeHomeChanged();
}
// "reset to estimate".
function resetTakeHome(){
  takeHomeOverride = null;
  netMonthlyIncome = estimatedNetMonthlyIncome;
  takeHomeEditOpen = false;
  takeHomeChanged();
}
// Draws again everything that shows a share of take-home or a fit label. The
// PDF report, Compare and the listings handover read netMonthlyIncome when
// they are used, so they follow on their own.
function takeHomeChanged(){
  renderTopSection();
  if(results.length) render();
  // An open What-If: its "Now" column was worked out on the old take-home.
  const panel = document.getElementById('scenarioPanel');
  if(panel && panel.style.display === 'block' && typeof _getAngleSnapshot === 'function'){
    _beforeSnapshot = _getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone);
    const sr = document.getElementById('scenarioResults');
    if(sr) sr.innerHTML = '';
  }
}

// "How we calculated this": opens and closes the small print under the line.
function toggleCalcDetails(){
  const box = document.getElementById('calcDetails'), btn = document.getElementById('calcDetailsBtn');
  if(!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  if(btn) btn.setAttribute('aria-expanded', String(open));
}

function go(){
  // `inc` is the household total: the buyer's income plus the optional
  // partner's income (2026-09-23; see readIncomes()).
  const incomes=readIncomes(), inc=incomes.total;
  const dn=parseFloat(document.getElementById("dwn").value)||0;
  const dbt=parseFloat(document.getElementById("dbt").value.trim())||0;
  existingDebt=dbt;
  customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100;
  const _sbr=document.getElementById('shareBar');
  if(_sbr) _sbr.style.display='none';
  const _scp=document.getElementById('scenarioPanel');
  if(_scp) _scp.style.display='none';
  const _rb=document.getElementById('rateBar');
  if(_rb){
    _rb.style.display='none';
    const _rs=document.getElementById('rateSlider');
    const _ri=document.getElementById('rateInput');
    if(_rs) _rs.value=DEFAULT_MORTGAGE_RATE_PCT;
    if(_ri) _ri.value=DEFAULT_MORTGAGE_RATE_PCT;
    const _rh=document.getElementById('rateHint');
    if(_rh) _rh.textContent='Current market rate';
  }
  // Resolve work location coords (only for a commuter; unanswered is not one)
  if(workArrangement === 'hybrid' || workArrangement === 'daily') {
    workZone = getWorkZone();
  } else {
    workZone = null;
  }
  // The commute limit defaults from the work style unless the buyer chose one
  // -- applied here too, not only in setWorkArrangement(), because a shared
  // link or a restored form can set the work style without that call.
  if(!maxCommuteTouched) { maxCommuteMin = DEFAULT_MAX_COMMUTE[workArrangement] || null; syncMaxCommuteSelect(); }
  // The one-line settings show what this search uses (2.3a): a postal code
  // set without the buyer opening its box is shown, and the lines are current.
  if(workArrangement === 'hybrid' || workArrangement === 'daily') openWorkPostalIfSet();
  syncFormLines();
  const area=document.getElementById("area").value,fam=document.getElementById("fam").value;
  const t=T.en;
  // Validation hardened 2026-09-22 (audit). Previously: an income of exactly 1
  // passed (`inc < 1` lets 1 through) and produced a buying power of $0; an
  // income of 1e400 became Infinity and rendered the literal text "$NaN" to the
  // buyer; a debt of Infinity silently collapsed buying power to the down
  // payment with no error; a negative debt was accepted and INCREASED buying
  // power; and when validation did reject the input, go() returned early
  // without clearing the buying-power box, so the buyer saw an error message
  // next to the previous run's number.
  const err=document.getElementById("err");
  const fail=(msg)=>{
    if(msg){ err.textContent=msg; err.style.display="block"; }
    const bp=document.getElementById("bpBox"); if(bp) bp.style.display="none";
    const bpv=document.getElementById("bpV"); if(bpv) bpv.textContent="";
    return false;
  };
  err.style.display="none";
  // The two unanswered-by-default questions (2.5). Their messages are shown
  // now, next to each question, so a buyer who also mistyped an amount sees
  // every problem at once; the search stops after the checks below.
  const choicesOk=checkRequiredChoices();
  // Checked before the total: -5,000 plus 100,000 would otherwise pass.
  if(incomes.own<0||incomes.partner<0) return void fail("Incomes can't be negative. Leave the partner box blank if you're buying on your own.");
  if(!Number.isFinite(inc)||inc<1000) return void fail(t.err);
  if(inc>10000000) return void fail("Please enter your annual household income before tax. That figure looks like a total net worth rather than a yearly income.");
  // A down payment is always required to purchase in Canada (min 5% on the
  // cheapest property). The per-property minimum-down-payment check against
  // each specific property's price happens inside getPriceForTypeStrict —
  // that's the correct place for it since "5% of what?" only makes sense
  // once an actual property price is known, not against theoretical buying power.
  if(!Number.isFinite(dn)||dn<=0) return void fail("A down payment is required to purchase a home in Canada.");
  if(dn>50000000) return void fail("That down payment is outside the range this calculator is built for.");
  if(dbt<0) return void fail("Monthly debt payments can't be negative. Enter 0 if you have none.");
  if(!Number.isFinite(dbt)||dbt>inc) return void fail("Your monthly debt payments look larger than your annual income. Enter the MONTHLY amount you pay, not the total balance owing.");
  if(!choicesOk){ showFirstUnansweredChoice(); return void fail(); }
  const btn=document.getElementById("goBtn");btn.disabled=true;btn.innerHTML='<div class="spin"></div>';
  try{
    const calc=calcBP(inc,dn,dbt);
    const{bp:b,comfortBP:cBP}=calc;
    buyPower=b;comfortBuyPower=cBP;fam_selected=fam;dn_selected=dn;grossMonthlyIncome=inc/12;
    // Take-home is taxed person by person (2026-09-23): it was
    // estimateOntarioNetAnnual(inc), one earner on the whole household income.
    partnerIncomeShare=inc>0?incomes.partner/inc:0;estimatedNetMonthlyIncome=householdNetAnnual(inc)/12;
    // The buyer's own take-home (2.2) holds while both incomes are the ones it
    // was given for; a search with a different income goes back to the estimate.
    if(takeHomeOverride&&(takeHomeOverride.own!==incomes.own||takeHomeOverride.partner!==incomes.partner||!(takeHomeOverride.monthly<=grossMonthlyIncome))) takeHomeOverride=null;
    netMonthlyIncome=takeHomeOverride?takeHomeOverride.monthly:estimatedNetMonthlyIncome;
    window._allMarkets=M;
    const cands=candidateCities(area,b);
    // The candidate cities, deliberately UNORDERED. They used to be sorted
    // here by homePilotSort() -- a hidden desirability score weighted by
    // income -- and that order, not the one on screen, is what the lead email
    // listed (REVIEW_BACKLOG.md P0-3). Ordering now happens in exactly one
    // place, rankCities() (ranking.js), when render() draws the cards.
    results=cands.map(m=>({...m,displayMax:Math.min(m.max,b),homePrice:Math.min(m.max,b)}));
    // A new search starts with "See all places" closed, in its default order.
    shownCards=[];showOverCommute=false;seeAllOpen=false;resultsSort='home';

    // ── THE TOP SECTION: the HomePilot comfort range (renderTopSection()) ──
    lastSearch={own:incomes.own,partner:incomes.partner,total:inc,dn,dbt,calc};
    takeHomeEditOpen=false;
    renderTopSection();
    const rateDisplay=(customMortgageRate*100).toFixed(2).replace(/\.?0+$/,'')+'%';
    const stressRateDisplay=(getStressRate(customMortgageRate)*100).toFixed(2)+'%';
    const rn=document.getElementById('rateNote');if(rn)rn.innerHTML=`Based on ${rateDisplay} mortgage rate · ${amortizationNote(firstTimeBuyer===true)} · Stress tested at ${stressRateDisplay} · <span style="color:rgba(255,255,255,0.6);font-style:italic">Educational estimate only — not a mortgage pre-approval. Actual qualification depends on lender underwriting, credit, and full application details.</span>`;
    const frn=document.getElementById('footerRateNote');
    if(frn) frn.innerHTML=`Estimates based on ${rateDisplay} mortgage rate, stress tested at ${stressRateDisplay} (higher of 5.25% or contract rate + 2%). Amortization: 25-year, or 30-year where 20%+ down qualifies. Property tax rates sourced from each municipality. Utilities estimated by family size and region. Maintenance at 1% of home value annually. Qualification estimates are educational only and do not represent mortgage approval — final qualification depends on lender underwriting, credit, property taxes, condo fees, heating costs, and program eligibility. Sandeep Takhar is a RE/MAX agent covering Bolton, Caledon, Orangeville and surrounding areas. 416-725-8087`;
    document.getElementById("bpBox").style.display="block";
    const es=document.getElementById("calcEmptyState");if(es)es.style.display="none";
    // The "N cities match your budget" line is written by render() now, which
    // is the only place that knows how many cities actually survive full
    // qualification. Setting it here from results.length (the M-table
    // pre-filter) is what made it disagree with the cards below it.
    document.getElementById("res").style.display="block";const pfb=document.getElementById("propFilterBar");if(pfb)pfb.style.display="block";
    activeProp='all';activeFit='all';
    document.querySelectorAll("[id^='pt-'],[id^='ft-']").forEach(b=>b.classList.remove("on"));const ptAll=document.getElementById('pt-all');if(ptAll)ptAll.classList.add('on');

    render();
    setTimeout(()=>document.getElementById("bpBox").scrollIntoView({behavior:"smooth",block:"start"}),100);
  }catch(e){document.getElementById("err").textContent="Error: "+e.message;document.getElementById("err").style.display="block";console.error(e);}
  btn.disabled=false;btn.innerHTML="<span id='bt'>"+T.en.bt+"</span>";
}
