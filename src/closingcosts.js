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
  const incVal = parseFloat(document.getElementById('inc').value) || 0;
  const warnEl = document.getElementById('dbt-warning');
  if(!warnEl) return;
  const monthlyIncome = incVal/12;
  const looksTooHigh = dbtVal > 0 && monthlyIncome > 0 && dbtVal > monthlyIncome*0.20;
  warnEl.style.display = looksTooHigh ? 'block' : 'none';
}
function setFTB(val){
  firstTimeBuyer=val;const yes=document.getElementById('ftb-yes'),no=document.getElementById('ftb-no');
  if(val){yes.style.background='#1D9E75';yes.style.color='#fff';yes.style.borderColor='#1D9E75';no.style.background='#fff';no.style.color='#555';no.style.borderColor='#e8e8e8';}
  else{no.style.background='#1D9E75';no.style.color='#fff';no.style.borderColor='#1D9E75';yes.style.background='#fff';yes.style.color='#555';yes.style.borderColor='#e8e8e8';}
}

function calcLTT(price,isToronto,ftb){
  let provincial=0;
  if(price<=55000)provincial=price*0.005;else if(price<=250000)provincial=275+(price-55000)*0.010;else if(price<=400000)provincial=2225+(price-250000)*0.015;else if(price<=2000000)provincial=4475+(price-400000)*0.020;else provincial=36475+(price-2000000)*0.025;
  const provRebate=ftb?Math.min(provincial,4000):0,provNet=Math.max(0,provincial-provRebate);
  let municipal=0,muniRebate=0;
  if(isToronto){
    if(price<=55000)municipal=price*0.005;else if(price<=250000)municipal=275+(price-55000)*0.010;else if(price<=400000)municipal=2225+(price-250000)*0.015;else if(price<=2000000)municipal=4475+(price-400000)*0.020;else municipal=36475+(price-2000000)*0.025;
    muniRebate=ftb?Math.min(municipal,4475):0;
  }
  const muniNet=Math.max(0,municipal-muniRebate);
  return{provincial,provRebate,provNet,municipal,muniRebate,muniNet,total:provNet+muniNet,totalRebate:provRebate+muniRebate};
}

function calcClosingCosts(cityName,price,ftb){
  const torontoCities=['Toronto - Downtown','Toronto - West End','Toronto - East End','Toronto - North York','Toronto - Etobicoke','Toronto - Scarborough'];
  const isToronto=torontoCities.includes(cityName),ltt=calcLTT(price,isToronto,ftb);
  // Legal fees scale with price (more complex transactions cost more)
  const legal=price>=1000000?3000:price>=700000?2500:2000;
  const titleIns=Math.round(price*0.0006); // ~0.06% of purchase price, min $400
  const titleInsAdj=Math.max(400,titleIns);
  const inspection=price>=800000?600:500;
  const moving=price>=800000?2500:2000;
  const adjustments=1500;
  const total=ltt.total+legal+titleInsAdj+inspection+moving+adjustments;
  return{ltt,legal,titleIns:titleInsAdj,inspection,moving,adjustments,total,isToronto};
}

function toggleCC(id){
  const toggle=document.getElementById(id),body=document.getElementById('ccb-'+id.replace('cc-',''));
  if(!toggle||!body)return;toggle.classList.toggle('open');body.classList.toggle('open');
}
