// leadform.js — HomePilot lead submission
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/leadform.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: confirmSendLead() (click handler entry point, referenced by
// onclick="confirmSendLead()" in the markup — closes the transparency modal
// then calls sub()) and sub() (the actual lead submission: validates the
// form, POSTs to the homepilot-send-lead Worker, checks both HTTP status and
// the {"ok":true/false} response field before showing success — this dual
// check was the fix for Bug 1, silent lead failure).

function confirmSendLead(){
  closeTransparencyModal();
  sub();
}

async function sub(){
  const nm=document.getElementById("nm").value,em=document.getElementById("em").value,ph=document.getElementById("ph").value;
  const status=document.getElementById("status").value,timeline=document.getElementById("timeline").value;
  const t=T[lang];if(!nm||!em)return;
  document.getElementById("subBtn").disabled=true;
  const leadErrEl=document.getElementById("leadErr");if(leadErrEl)leadErrEl.style.display="none";

  // Enriched payload — built July 13, 2026 after three independent AI audits converged
  // on the same gap: the lead Sandeep received had no calculator context (income, down
  // payment, debt, work location, or which specific homes matched), meaning every
  // conversation started from scratch. This now includes exactly what the buyer saw.
  const incomeVal=parseFloat(document.getElementById('inc').value)||0;
  const downPaymentVal=parseFloat(document.getElementById('dwn').value)||0;
  const debtVal=parseFloat(document.getElementById('dbt').value)||0;
  const workCityVal=document.getElementById('workCity')?document.getElementById('workCity').value:'';
  const topMatches=results.slice(0,5).map(x=>getLeadSummaryForCity(x.n)).filter(Boolean);

  const leadPayload={
    name:nm, email:em, phone:ph, status, timeline, lang,
    income:incomeVal,
    downPayment:downPaymentVal,
    existingMonthlyDebt:debtVal,
    familySize:fam_selected,
    firstTimeBuyer:firstTimeBuyer,
    workCity:workCityVal,
    workArrangement:workArrangement,
    bankBuyingPower:buyPower,
    comfortBuyingPower:comfortBuyPower,
    mortgageRatePct:(customMortgageRate*100).toFixed(2),
    topMatches:topMatches, // [{city, type, price, monthlyCost}, ...] — exactly what buyer saw
    topCitiesSummary:topMatches.map(m=>`${m.city} (${m.type} $${m.price.toLocaleString()}, $${m.monthlyCost.toLocaleString()}/mo)`).join(' | '),
    // Legacy fields kept for backward compatibility with the existing Formspree inbox view
    buyingPower:document.getElementById("bpV").textContent,
    cities:results.slice(0,5).map(x=>x.n).join(", ")
  };

  // Lead delivery — Cloudflare Worker using Cloudflare's native Email Sending.
  // Replaces the old Formspree endpoint (malformed URL, silently failed for every
  // buyer since this build shipped — fixed July 16, 2026). This call is awaited and
  // its real success/failure is checked before the success screen is ever shown.
  let sendSucceeded = false;
  try {
    const res = await fetch("https://homepilot-send-lead.stakharrealty.workers.dev",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(leadPayload)
    });
    const data = await res.json().catch(()=>({ok:false}));
    sendSucceeded = res.ok && data.ok;
  } catch(e) {
    sendSucceeded = false;
  }

  // Zapier webhook -> Follow Up Boss. SANDEEP: replace ZAPIER_WEBHOOK_URL_HERE with your
  // actual Zapier "Catch Hook" URL once the Zap is created (Webhook trigger -> Follow Up
  // Boss "Create or Update Person" action). Fails silently if not yet configured, so this
  // is safe to leave as-is until you're ready to wire it up. This one stays fire-and-forget
  // since it's a secondary CRM sync, not the primary lead-delivery path.
  const ZAPIER_WEBHOOK_URL = "ZAPIER_WEBHOOK_URL_HERE";
  if(ZAPIER_WEBHOOK_URL && ZAPIER_WEBHOOK_URL !== "ZAPIER_WEBHOOK_URL_HERE"){
    fetch(ZAPIER_WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(leadPayload)}).catch(()=>{});
  }

  if(sendSucceeded){
    document.getElementById("cap").style.display="none";document.getElementById("done").style.display="block";
    document.getElementById("dtt").textContent=t.dtt;document.getElementById("dtp").textContent=t.dtp;
    document.getElementById("done").scrollIntoView({behavior:"smooth"});
  } else {
    document.getElementById("subBtn").disabled=false;
    const leadErrEl2=document.getElementById("leadErr");if(leadErrEl2)leadErrEl2.style.display="block";
  }
}
