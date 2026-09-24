// closingcosts.js — HomePilot land transfer tax / closing costs calculator
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/closingcosts.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: checkDebtSanity() (flags apparent total-loan-balance entry in the
// debt field), setFTB() (first-time-buyer toggle), calcLTT() (land transfer
// tax), calcClosingCosts() (LTT + legal fees + title insurance estimate),
// toggleCC() (show/hide the closing costs panel).

function checkDebtSanity(){
  // Buyers sometimes type a total loan balance (e.g. "15000" for a car loan) instead
  // of the monthly payment (e.g. "400"). A debt figure over 20% of monthly gross income
  // is almost never a real monthly obligation — flag it so they don't get incorrectly
  // disqualified by their own typo.
  const dbtVal = parseFloat(document.getElementById('dbt').value) || 0;
  // Both incomes (2026-09-23): the debt is the household's, so is the income.
  const incVal = typeof readIncomes === 'function' ? readIncomes().total : (parseFloat(document.getElementById('inc').value) || 0);
  const warnEl = document.getElementById('dbt-warning');
  if(!warnEl) return;
  const monthlyIncome = incVal/12;
  const looksTooHigh = dbtVal > 0 && monthlyIncome > 0 && dbtVal > monthlyIncome*0.20;
  warnEl.style.display = looksTooHigh ? 'block' : 'none';
}
// Paints a Yes/No button pair. Anything but true/false paints neither as
// picked (the first-time question starts unanswered; IMPROVEMENT_PLAN.md 2.5).
function paintYesNo(yesId, noId, val){
  const yes=document.getElementById(yesId),no=document.getElementById(noId);
  if(!yes||!no)return;
  if(val!==true&&val!==false){[yes,no].forEach(b=>{b.style.background='#fff';b.style.color='#3D4555';b.style.borderColor='#E4E7EC';});}
  else if(val){yes.style.background='#1D9E75';yes.style.color='#fff';yes.style.borderColor='#1D9E75';no.style.background='#fff';no.style.color='#555';no.style.borderColor='#e8e8e8';}
  else{no.style.background='#1D9E75';no.style.color='#fff';no.style.borderColor='#1D9E75';yes.style.background='#fff';yes.style.color='#555';yes.style.borderColor='#e8e8e8';}
}
function setFTB(val){
  firstTimeBuyer=val;paintYesNo('ftb-yes','ftb-no',val);
  // Answered: clear the "Please choose Yes or No" message (main.js, 2.5).
  if(val===true||val===false){const fe=document.getElementById('ftb_err');if(fe)fe.style.display='none';}
  // The land transfer tax rebate question only means anything for a
  // first-time buyer (see lttRebateApplies below).
  const row=document.getElementById('ltt_rebate_row');if(row)row.style.display=val?'flex':'none';
  if(!val){lttRebateConfirmed=false;const cb=document.getElementById('lttRebate');if(cb)cb.checked=false;}
}
function setLttRebateConfirmed(val){ lttRebateConfirmed=val===true; }
function setResident(val){ canadianResident=val===true; paintYesNo('res-yes','res-no',canadianResident); }

// ── WHO GETS WHAT (added 2026-09-23, IMPROVEMENT_PLAN.md 1.7) ─────────────
// "First-time buyer" means two different things, and the app used one answer
// for both:
//   - The 30-year insured amortization uses the federal definition, which a
//     newcomer who owned a flat abroad years ago can still meet.
//   - The land transfer tax rebates are stricter. Ontario's refund (up to
//     $4,000) and Toronto's (up to $4,475) both require that the buyer has
//     NEVER owned a home anywhere in the world, that their spouse has not
//     either while married to them, and that the buyer is a Canadian citizen
//     or permanent resident (or becomes one within 18 months).
//     Sources, checked 2026-09-23: ontario.ca "Land transfer tax refunds for
//     first-time homebuyers"; toronto.ca "MLTT & MNRST rebate opportunities".
// So a newcomer who once owned a home abroad was shown a rebate of up to
// $4,000 ($8,475 in Toronto) they would not receive, deducted from their
// cash to close. The rebate now applies only when the buyer confirms both.
function lttRebateApplies(isFirstTime, neverOwnedAnywhere, citizenOrPR){
  return isFirstTime===true && neverOwnedAnywhere===true && citizenOrPR!==false;
}

// Non-resident speculation taxes, paid by foreign nationals (anyone who is not
// a Canadian citizen or permanent resident). Checked 2026-09-23:
//   - Ontario NRST: 25% of the price, province-wide, since October 25, 2022
//     (ontario.ca "Non-Resident Speculation Tax").
//   - Toronto MNRST: a further 10%, since January 1, 2025 (toronto.ca).
// Both exempt Ontario Immigrant Nominee Program nominees, protected persons,
// and foreign nationals buying with a citizen or PR spouse, and both rebate
// buyers who become permanent residents within four years. The app cannot
// know which applies, so it shows the tax and says so.
const ONTARIO_NRST_RATE = 0.25;
const TORONTO_MNRST_RATE = 0.10;

function calcLTT(price,isToronto,ftb){
  let provincial=0;
  if(price<=55000)provincial=price*0.005;else if(price<=250000)provincial=275+(price-55000)*0.010;else if(price<=400000)provincial=2225+(price-250000)*0.015;else if(price<=2000000)provincial=4475+(price-400000)*0.020;else provincial=36475+(price-2000000)*0.025;
  const provRebate=ftb?Math.min(provincial,4000):0,provNet=Math.max(0,provincial-provRebate);
  let municipal=0,muniRebate=0;
  if(isToronto){
    // Toronto MLTT. The luxury tiers above $3M were added by the City of
    // Toronto effective January 1, 2024 and were missing here (audit,
    // 2026-09-22) — everything over $2M was charged a flat 2.5%, understating
    // the municipal tax on high-value homes by six figures at the top end.
    if(price<=55000)municipal=price*0.005;
    else if(price<=250000)municipal=275+(price-55000)*0.010;
    else if(price<=400000)municipal=2225+(price-250000)*0.015;
    else if(price<=2000000)municipal=4475+(price-400000)*0.020;
    else if(price<=3000000)municipal=36475+(price-2000000)*0.025;
    else if(price<=4000000)municipal=61475+(price-3000000)*0.035;
    else if(price<=5000000)municipal=96475+(price-4000000)*0.045;
    else if(price<=10000000)municipal=141475+(price-5000000)*0.055;
    else if(price<=20000000)municipal=416475+(price-10000000)*0.065;
    else municipal=1066475+(price-20000000)*0.075;
    muniRebate=ftb?Math.min(municipal,4475):0;
  }
  const muniNet=Math.max(0,municipal-muniRebate);
  return{provincial,provRebate,provNet,municipal,muniRebate,muniNet,total:provNet+muniNet,totalRebate:provRebate+muniRebate};
}

// `ftb` here means "the first-time buyer rebates apply" -- callers decide that
// with lttRebateApplies() above, not with the bare first-time answer.
// opts.foreignBuyer (added 2026-09-23): the buyer is not a Canadian citizen or
// permanent resident, so the non-resident speculation taxes apply.
function calcClosingCosts(cityName,price,ftb,opts){
  const torontoCities=['Toronto - Downtown','Toronto - West End','Toronto - East End','Toronto - North York','Toronto - Etobicoke','Toronto - Scarborough'];
  const foreignBuyer=!!(opts&&opts.foreignBuyer);
  // A foreign buyer is never eligible for the first-time rebates.
  const isToronto=torontoCities.includes(cityName),ltt=calcLTT(price,isToronto,ftb&&!foreignBuyer);
  // Legal fees scale with price (more complex transactions cost more)
  const legal=price>=1000000?3000:price>=700000?2500:2000;
  const titleIns=Math.round(price*0.0006); // ~0.06% of purchase price, min $400
  const titleInsAdj=Math.max(400,titleIns);
  const inspection=price>=800000?600:500;
  const moving=price>=800000?2500:2000;
  const adjustments=1500;
  const nrst=foreignBuyer?Math.round(price*ONTARIO_NRST_RATE):0;
  const mnrst=foreignBuyer&&isToronto?Math.round(price*TORONTO_MNRST_RATE):0;
  const total=ltt.total+legal+titleInsAdj+inspection+moving+adjustments+nrst+mnrst;
  return{ltt,legal,titleIns:titleInsAdj,inspection,moving,adjustments,nrst,mnrst,foreignBuyer,total,isToronto};
}

function toggleCC(id){
  const toggle=document.getElementById(id),body=document.getElementById('ccb-'+id.replace('cc-',''));
  if(!toggle||!body)return;toggle.classList.toggle('open');body.classList.toggle('open');
}
