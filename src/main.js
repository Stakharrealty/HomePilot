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
// existingDebt, activeProp, activeFit, devMode, workArrangement, workZone),
// setWorkArrangement(), and go() — the main calculation orchestrator that
// runs when the buyer submits the form.

const RF={all:null,gta:["gta"],west:["west"],east:["east"],north:["north"],duff:["duff"],niag:["niag"],wloo:["wloo"],east2:["east2"]};
let lang="en",results=[],buyPower=0,comfortBuyPower=0,fam_selected="3",dn_selected=0,grossMonthlyIncome=0,netMonthlyIncome=0,customMortgageRate=DEFAULT_MORTGAGE_RATE_PCT/100,firstTimeBuyer=false,existingDebt=0;

let activeProp='all',activeFit='all',devMode=false;

let workArrangement = 'remote';
let workZone = null;

function setWorkArrangement(type) {
  workArrangement = type;
  const sel = document.getElementById('waSelect');
  if(sel && sel.value !== type) sel.value = type;
  const fields = document.getElementById('workLocationFields');
  const hint = document.getElementById('wa_hint');
  if(type === 'remote') {
    if(fields) fields.style.display = 'none';
    if(hint) hint.textContent = 'Remote workers get recommendations ranked purely by affordability.';
  } else {
    if(fields) fields.style.display = 'flex';
    if(hint) hint.textContent = type === 'daily'
      ? 'Commute carries more weight for daily workers — we\'ll prioritize cities that work for your drive.'
      : 'Hybrid workers get a balanced view — affordability and reasonable commute.';
  }
  workZone = null;
  if(results.length) render();
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
  const area=document.getElementById("area").value,fam=document.getElementById("fam").value;
  const t=T[lang];
  document.getElementById("err").style.display="none";
  if(!inc||inc<1){document.getElementById("err").textContent=t.err;document.getElementById("err").style.display="block";return;}
  // A down payment is always required to purchase in Canada (min 5% on the
  // cheapest property). The per-property minimum-down-payment check against
  // each specific property's price happens inside getPriceForTypeStrict —
  // that's the correct place for it since "5% of what?" only makes sense
  // once an actual property price is known, not against theoretical buying power.
  if(dn<=0){
    document.getElementById("err").textContent="A down payment is required to purchase a home in Canada.";
    document.getElementById("err").style.display="block";
    return;
  }
  const btn=document.getElementById("goBtn");btn.disabled=true;btn.innerHTML='<div class="spin"></div>';
  try{
    const{bp:b,comfortBP:cBP,mo,comfortMo}=calcBP(inc,dn,dbt);
    buyPower=b;comfortBuyPower=cBP;fam_selected=fam;dn_selected=dn;grossMonthlyIncome=inc/12;netMonthlyIncome=estimateOntarioNetAnnual(inc)/12;
    window._allMarkets=M;
    const rf=RF[area],seen=new Set();
    const cands=M.filter(m=>{if(seen.has(m.n))return false;seen.add(m.n);if(rf&&!rf.includes(m.r))return false;return m.min<=b;});
    const preSorted=cands.map(m=>{
      const homePrice=Math.min(m.max,b),dynPrice=getPriceForType(m.n,activeProp!=='all'?activeProp:'detached',b)||homePrice;
      const costData=calcCosts(m,homePrice,fam,dn,'detached'),ft=getFit(costData.total,inc/12);
      const cityWithFit={...m,dynPrice,ft};
      const hpScore=getHomePilotScore(cityWithFit,inc,b),hpReasons=getCityScoreReasons(cityWithFit,inc,b,hpScore);
      return{...m,c:costData,ft,displayMax:Math.min(m.max,b),homePrice,dynPrice,hpScore,hpReasons};
    }).sort((a,bx)=>homePilotSort(a,bx,inc,buyPower));
    results=preSorted;

    // ── BUYING POWER BOX: show both bank ceiling and HomePilot comfort range ──
    document.getElementById("bpV").textContent=fc(b);
    const rateDisplay=(customMortgageRate*100).toFixed(2).replace(/\.?0+$/,'')+'%';
    document.getElementById("bpSub").innerHTML=
      `<div style="margin-bottom:10px">Based on income ${fc(inc)}/yr · Down payment ${fc(dn)} · Debt ${fc(dbt)}/mo</div>`+
      `<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">`+
        `<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px">`+
          `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.8;font-weight:600;margin-bottom:4px">Bank qualifies you for</div>`+
          `<div style="font-size:20px;font-weight:800">${fc(b)}</div>`+
          `<div style="font-size:11px;opacity:0.7;margin-top:3px">Estimated ceiling — not a pre-approval</div>`+
        `</div>`+
        `<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.28);border-radius:10px;padding:10px 12px;border:1.5px solid rgba(255,255,255,0.4)">`+
          `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.9;font-weight:700;margin-bottom:4px">✓ HomePilot comfort range</div>`+
          `<div style="font-size:20px;font-weight:800">${fc(cBP)}</div>`+
          `<div style="font-size:11px;opacity:0.75;margin-top:3px">Stay here to breathe financially</div>`+
        `</div>`+
      `</div>`;
    const stressRateDisplay=(getStressRate(customMortgageRate)*100).toFixed(2)+'%';
    const rn=document.getElementById('rateNote');if(rn)rn.innerHTML=`Based on ${rateDisplay} mortgage rate · 25-year amortization (30-year available at 20%+ down) · Stress tested at ${stressRateDisplay} · <span style="color:rgba(255,255,255,0.6);font-style:italic">Educational estimate only — not a mortgage pre-approval. Actual qualification depends on lender underwriting, credit, and full application details.</span>`;
    const frn=document.getElementById('footerRateNote');
    if(frn) frn.innerHTML=`Estimates based on ${rateDisplay} mortgage rate, stress tested at ${stressRateDisplay} (higher of 5.25% or contract rate + 2%). Amortization: 25-year, or 30-year where 20%+ down qualifies. Property tax rates sourced from each municipality. Utilities estimated by family size and region. Maintenance at 1% of home value annually. Qualification estimates are educational only and do not represent mortgage approval — final qualification depends on lender underwriting, credit, property taxes, condo fees, heating costs, and program eligibility. Sandeep Takhar is a RE/MAX agent covering Bolton, Caledon, Orangeville and surrounding areas. English · Français · 中文 · Punjabi · Hindi · Urdu · 416-725-8087`;
    document.getElementById("bpBox").style.display="block";
    document.getElementById("cnt").innerHTML="<span>"+results.length+" cities</span> match your budget — tap any city to see the full monthly breakdown";
    document.getElementById("res").style.display="block";document.getElementById("cap").style.display="block";const pfb=document.getElementById("propFilterBar");if(pfb)pfb.style.display="block";
    activeProp='all';activeFit='all';
    document.querySelectorAll("[id^='pt-'],[id^='ft-']").forEach(b=>b.classList.remove("on"));const ptAll=document.getElementById('pt-all');if(ptAll)ptAll.classList.add('on');

    render();
    setTimeout(()=>document.getElementById("bpBox").scrollIntoView({behavior:"smooth",block:"start"}),100);
  }catch(e){document.getElementById("err").textContent="Error: "+e.message;document.getElementById("err").style.display="block";console.error(e);}
  btn.disabled=false;btn.innerHTML="<span id='bt'>"+T[lang].bt+"</span>";
}
