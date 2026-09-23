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
// (lang, results, buyPower, comfortBuyPower, fam_selected, dn_selected,
// grossMonthlyIncome, netMonthlyIncome, customMortgageRate, firstTimeBuyer,
// existingDebt, activeProp, activeFit, devMode, workArrangement, workZone,
// maxCommuteMin, resultsSort, showOverCommute, shownCards),
// setWorkArrangement(), setMaxCommute(), setResultsSort(), toggleOverCommute(),
// amortizationNote(), and go() — the main calculation orchestrator that runs
// when the buyer submits the form.

const RF={all:null,gta:["gta"],west:["west"],east:["east"],north:["north"],duff:["duff"],niag:["niag"],wloo:["wloo"],east2:["east2"]};
let lang="en",results=[],buyPower=0,comfortBuyPower=0,fam_selected="3",dn_selected=0,grossMonthlyIncome=0,netMonthlyIncome=0,customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100,firstTimeBuyer=false,existingDebt=0;

let activeProp='all',activeFit='all',devMode=false;

let workArrangement = 'remote';
let workZone = null;

// Commute limit, result order and the on-screen record (added 2026-09-23,
// IMPROVEMENT_PLAN.md 1.2 / 1.4 -- see ranking.js):
//   maxCommuteMin     -- longest one-way drive the buyer accepts, in minutes;
//                        null = no limit. Defaults per work style
//                        (DEFAULT_MAX_COMMUTE) until the buyer picks one.
//   maxCommuteTouched -- true once the buyer has picked, so switching work
//                        style no longer overrides their choice.
//   resultsSort       -- 'home' | 'commute' | 'cost' (RESULT_SORTS).
//   showOverCommute   -- the buyer asked to see the cities past their limit.
//   shownCards        -- the cards render() last drew, in screen order. The
//                        lead is built from this, so it is exactly what the
//                        buyer saw (REVIEW_BACKLOG.md P0-3).
let maxCommuteMin = null, maxCommuteTouched = false, resultsSort = 'home', showOverCommute = false, shownCards = [];

// Two answers the land transfer tax depends on (added 2026-09-23,
// IMPROVEMENT_PLAN.md 1.7; the rules and their sources are in closingcosts.js):
//   lttRebateConfirmed -- the buyer ticked "neither I nor my spouse has ever
//                         owned a home, anywhere in the world". Off until
//                         they do, so no rebate is shown to someone who
//                         owned a home abroad.
//   canadianResident   -- citizen or permanent resident. When false, the
//                         non-resident speculation taxes apply, the rebates
//                         don't, and the results say most non-Canadians
//                         cannot buy yet.
let lttRebateConfirmed = false, canadianResident = true;
function buyerLttRebateApplies(){ return lttRebateApplies(firstTimeBuyer, lttRebateConfirmed, canadianResident); }

function setWorkArrangement(type) {
  workArrangement = type;
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
  }
  workZone = null;
  if(results.length) render();
}

function syncMaxCommuteSelect() {
  const sel = document.getElementById('maxCommute');
  if(sel) sel.value = maxCommuteMin ? String(maxCommuteMin) : 'none';
}

// The "Longest commute you'd accept (one way)" select. Takes effect on the
// results already on screen.
function setMaxCommute(value) {
  const n = parseInt(value, 10);
  maxCommuteMin = MAX_COMMUTE_CHOICES.includes(n) ? n : null;
  maxCommuteTouched = true;
  showOverCommute = false;
  if(results.length) render();
}

// The sort switch above the results.
function setResultsSort(sort) {
  resultsSort = RESULT_SORTS.includes(sort) ? sort : 'home';
  if(results.length) render();
}

// "Show them" / "Hide them" on the note about cities past the commute limit.
function toggleOverCommute() {
  showOverCommute = !showOverCommute;
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

function go(){
  const inc=parseFloat(document.getElementById("inc").value)||0;
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
  // Resolve work location coords
  if(workArrangement !== 'remote') {
    workZone = getWorkZone();
  } else {
    workZone = null;
  }
  // The commute limit defaults from the work style unless the buyer chose one
  // -- applied here too, not only in setWorkArrangement(), because a shared
  // link or a restored form can set the work style without that call.
  if(!maxCommuteTouched) { maxCommuteMin = DEFAULT_MAX_COMMUTE[workArrangement] || null; syncMaxCommuteSelect(); }
  const area=document.getElementById("area").value,fam=document.getElementById("fam").value;
  const t=T[lang];
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
    err.textContent=msg; err.style.display="block";
    const bp=document.getElementById("bpBox"); if(bp) bp.style.display="none";
    const bpv=document.getElementById("bpV"); if(bpv) bpv.textContent="";
    return false;
  };
  err.style.display="none";
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
  const btn=document.getElementById("goBtn");btn.disabled=true;btn.innerHTML='<div class="spin"></div>';
  try{
    const{bp:b,comfortBP:cBP,mo,comfortMo,downPaymentLimited,incomeCapBP,downPaymentShortfall}=calcBP(inc,dn,dbt);
    buyPower=b;comfortBuyPower=cBP;fam_selected=fam;dn_selected=dn;grossMonthlyIncome=inc/12;netMonthlyIncome=estimateOntarioNetAnnual(inc)/12;
    window._allMarkets=M;
    const cands=candidateCities(area,b);
    // The candidate cities, deliberately UNORDERED. They used to be sorted
    // here by homePilotSort() -- a hidden desirability score weighted by
    // income -- and that order, not the one on screen, is what the lead email
    // listed (REVIEW_BACKLOG.md P0-3). Ordering now happens in exactly one
    // place, rankCities() (ranking.js), when render() draws the cards.
    results=cands.map(m=>({...m,displayMax:Math.min(m.max,b),homePrice:Math.min(m.max,b)}));
    shownCards=[];showOverCommute=false;

    // ── BUYING POWER BOX: show both bank ceiling and HomePilot comfort range ──
    document.getElementById("bpV").textContent=fc(b);
    const rateDisplay=(customMortgageRate*100).toFixed(2).replace(/\.?0+$/,'')+'%';
    document.getElementById("bpSub").innerHTML=
      `<div style="margin-bottom:10px">Based on income ${fc(inc)}/yr · Down payment ${fc(dn)} · Debt ${fc(dbt)}/mo</div>`+
      `<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">`+
        `<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px">`+
          `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.8;font-weight:600;margin-bottom:4px">Bank qualifies you for</div>`+
          `<div style="font-size:20px;font-weight:800">${fc(b)}</div>`+
          `<div style="font-size:11px;opacity:0.7;margin-top:3px">${downPaymentLimited?'Limited by your down payment, not your income':'Estimated ceiling — not a pre-approval'}</div>`+
        `</div>`+
        `<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.28);border-radius:10px;padding:10px 12px;border:1.5px solid rgba(255,255,255,0.4)">`+
          `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.9;font-weight:700;margin-bottom:4px">✓ HomePilot comfort range</div>`+
          `<div style="font-size:20px;font-weight:800">${fc(cBP)}</div>`+
          `<div style="font-size:11px;opacity:0.75;margin-top:3px">Stay here to breathe financially</div>`+
        `</div>`+
      `</div>`+
      // Savings-gap note (added 2026-09-22). When the down payment is what
      // caps the buyer rather than their income, calcBP() now reports the
      // ceiling income ALONE would support and how much more they would need
      // saved to reach it. Without this the buyer just sees a smaller number
      // and no reason for it — and the reason is the single most actionable
      // thing HomePilot can tell someone at this stage: a savings target.
      // Only ever shown when the gap is real (both figures present).
      (downPaymentLimited && downPaymentShortfall>0 && incomeCapBP>b
        ? `<div style="margin-top:12px;background:rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px;border-left:3px solid rgba(255,255,255,0.55)">`+
            `<div style="font-size:12px;font-weight:700;margin-bottom:3px">Your savings are the limit here, not your income</div>`+
            `<div style="font-size:12px;opacity:0.9;line-height:1.5">On your income you could qualify for up to <b>${fc(incomeCapBP)}</b>. `+
            `A home at that price needs a larger down payment than you have — about <b>${fc(downPaymentShortfall)} more saved</b> would get you there.</div>`+
          `</div>`
        : ``)+
      // Non-residents (added 2026-09-23, IMPROVEMENT_PLAN.md 1.7). The federal
      // ban on non-Canadians buying homes runs until January 1, 2027, with
      // exceptions (e.g. work-permit holders with 183+ days left; CMHC,
      // checked 2026-09-23). Ontario's 25% NRST and Toronto's 10% MNRST are
      // added to cash to close in each city's breakdown.
      (canadianResident===false
        ? `<div id="nonResidentNote" style="margin-top:12px;background:rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px;border-left:3px solid rgba(255,255,255,0.55)">`+
            `<div style="font-size:12px;font-weight:700;margin-bottom:3px">If you're not a Canadian citizen or permanent resident</div>`+
            `<div style="font-size:12px;opacity:0.9;line-height:1.5">Most non-Canadians can't buy a home in Canada until at least January 1, 2027 (a federal ban). Some are exempt — for example, many work-permit holders with at least 183 days left on their permit. `+
            `If you can buy, Ontario charges a 25% non-resident speculation tax on the price, plus 10% in Toronto; it's included in each city's cash to close below, though some buyers are exempt or can get it back. `+
            `Lenders also treat non-residents differently, so the figures above may be too high. Speak to a real estate lawyer before you make an offer.</div>`+
          `</div>`
        : ``);
    const stressRateDisplay=(getStressRate(customMortgageRate)*100).toFixed(2)+'%';
    const rn=document.getElementById('rateNote');if(rn)rn.innerHTML=`Based on ${rateDisplay} mortgage rate · ${amortizationNote(firstTimeBuyer===true)} · Stress tested at ${stressRateDisplay} · <span style="color:rgba(255,255,255,0.6);font-style:italic">Educational estimate only — not a mortgage pre-approval. Actual qualification depends on lender underwriting, credit, and full application details.</span>`;
    const frn=document.getElementById('footerRateNote');
    if(frn) frn.innerHTML=`Estimates based on ${rateDisplay} mortgage rate, stress tested at ${stressRateDisplay} (higher of 5.25% or contract rate + 2%). Amortization: 25-year, or 30-year where 20%+ down qualifies. Property tax rates sourced from each municipality. Utilities estimated by family size and region. Maintenance at 1% of home value annually. Qualification estimates are educational only and do not represent mortgage approval — final qualification depends on lender underwriting, credit, property taxes, condo fees, heating costs, and program eligibility. Sandeep Takhar is a RE/MAX agent covering Bolton, Caledon, Orangeville and surrounding areas. English · Français · 中文 · Punjabi · Hindi · Urdu · 416-725-8087`;
    document.getElementById("bpBox").style.display="block";
    const es=document.getElementById("calcEmptyState");if(es)es.style.display="none";
    // The "N cities match your budget" line is written by render() now, which
    // is the only place that knows how many cities actually survive full
    // qualification. Setting it here from results.length (the M-table
    // pre-filter) is what made it disagree with the cards below it.
    document.getElementById("res").style.display="block";document.getElementById("cap").style.display="block";const pfb=document.getElementById("propFilterBar");if(pfb)pfb.style.display="block";const sbr=document.getElementById("sortBar");if(sbr)sbr.style.display="block";
    activeProp='all';activeFit='all';
    document.querySelectorAll("[id^='pt-'],[id^='ft-']").forEach(b=>b.classList.remove("on"));const ptAll=document.getElementById('pt-all');if(ptAll)ptAll.classList.add('on');

    render();
    setTimeout(()=>document.getElementById("bpBox").scrollIntoView({behavior:"smooth",block:"start"}),100);
  }catch(e){document.getElementById("err").textContent="Error: "+e.message;document.getElementById("err").style.display="block";console.error(e);}
  btn.disabled=false;btn.innerHTML="<span id='bt'>"+T[lang].bt+"</span>";
}
