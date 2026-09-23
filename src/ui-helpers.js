// ui-helpers.js — HomePilot small UI interaction helpers
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/ui-helpers.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: setLang() (switches active language, re-renders all translated
// text), toggleTooltip() + its document click-listener (closes open tooltips
// on outside click — safe to load early since it only touches `document`
// itself, not specific elements that need to exist first), filtProp(),
// filtFit(), filt(), updateCardCosts() (property-type/fit filter UI),
// toggle() (generic card expand/collapse), showTransparencyModal(),
// closeTransparencyModal().

function setLang(l){
  lang=l;const t=T[l];
  const waLbl=document.getElementById('wa_lbl');if(waLbl)waLbl.textContent=t.wa_lbl||'Work arrangement';
  const wcLbl=document.getElementById('wc_lbl');if(wcLbl)wcLbl.childNodes[0].textContent=t.wc_lbl||'Work city';
  const wpLbl=document.getElementById('wp_lbl');
  if(wpLbl){const span=wpLbl.querySelector('span');const txt=t.wp_lbl||'Work postal code';if(span){wpLbl.childNodes[0].textContent=txt+' ';} else wpLbl.textContent=txt;}
  const workCity=document.getElementById('workCity');if(workCity)workCity.placeholder=t.wc_ph||'e.g. Brampton';
  const workPostal=document.getElementById('workPostal');if(workPostal)workPostal.placeholder=t.wp_ph||'e.g. L6Y 0A1';
  const mcLbl=document.getElementById('mc_lbl');if(mcLbl)mcLbl.textContent=t.mc_lbl||"Longest commute you'd accept (one way)";
  const mcSel=document.getElementById('maxCommute');
  if(mcSel)[...mcSel.options].forEach(o=>{o.text=o.value==='none'?(t.mc_none||'No limit'):o.value+' '+(t.mc_min||'minutes');});
  // First-time buyer, rebate and residency questions (translated from 2026-09-23).
  [['ftb_lbl','ftb_lbl'],['ftb_hint','ftb_hint'],['ltt_lbl','ltt_lbl'],['res_lbl','res_lbl'],['res_hint','res_hint'],
   ['ftb-yes','yes'],['ftb-no','no'],['res-yes','yes'],['res-no','no']].forEach(([id,k])=>{const el=document.getElementById(id);if(el&&t[k])el.textContent=t[k];});
  const waSelectEl=document.getElementById('waSelect');
  if(waSelectEl&&waSelectEl.options.length>=3){
    waSelectEl.options[0].text=t.wa_remote||'Remote';
    waSelectEl.options[1].text=t.wa_hybrid||'Hybrid (2–4 days/week)';
    waSelectEl.options[2].text=t.wa_daily||'Daily (5+ days/week)';
  }
  const textIds=[["ht","ht"],["hs","hs"],["l1","l1"],["l1b","l1b"],["l1b_opt","l1b_opt"],["l2","l2"],["l3","l3"],["l4","l4"],["l5","l5"],["bt","bt"],["ctt","ctt"],["ctp","ctp"],["st","st"],["dtt","dtt"],["dtp","dtp"],["bp_lbl","bp_lbl"],["bp_sub_txt","bp_sub"],["cities_title_el","cities_title"]];
  textIds.forEach(([id,k])=>{const el=document.getElementById(id);if(el&&t[k])el.innerHTML=t[k];});
  const l3inc=document.getElementById("l3_inc");if(l3inc)l3inc.textContent=t.l3_inc;
  const l3exc=document.getElementById("l3_exc");if(l3exc)l3exc.textContent=t.l3_exc;
  const l3zero=document.getElementById("l3_zero");if(l3zero)l3zero.textContent=t.l3_zero;
  const inc2=document.getElementById("inc2");if(inc2&&t.inc2_ph)inc2.placeholder=t.inc2_ph; // partner's income (2026-09-23)
  const nm=document.getElementById("nm");if(nm)nm.placeholder=t.fn_ph;
  const em=document.getElementById("em");if(em)em.placeholder=t.em_ph;
  const ph=document.getElementById("ph");if(ph)ph.placeholder=t.ph_ph;
  ["fn_lbl","em_lbl","ph_lbl","q1_lbl","q2_lbl"].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.textContent=t[["fn","em","ph","q1","q2"][i]];});
  ["pt-all","pt-condo","pt-town","pt-semi","pt-detached"].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.textContent=t[["filter_all","filter_condo","filter_town","filter_semi","filter_det"][i]];});
  ["ft-all","ft-great","ft-good","ft-stretch"].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.textContent=t[["fit_all","fit_great","fit_good","fit_stretch"][i]];});
  const areaEl=document.getElementById("area");
  if(areaEl){const areaMap={all:"area_all",gta:"area_gta",west:"area_west",east:"area_east",north:"area_north",duff:"area_duff",niag:"area_niag",wloo:"area_wloo",east2:"area_east2"};[...areaEl.options].forEach(o=>{if(areaMap[o.value])o.text=t[areaMap[o.value]];});}
  const famEl=document.getElementById("fam");
  if(famEl){const famMap=["","fam1","fam2","fam3","fam4","fam5"];[...famEl.options].forEach((o,i)=>{if(famMap[i])o.text=t[famMap[i]];});}
  const statusEl=document.getElementById("status");
  if(statusEl){const opts=statusEl.options;if(opts[0])opts[0].text=t.q1_ph;if(opts[1])opts[1].text=t.q1_a;if(opts[2])opts[2].text=t.q1_b;if(opts[3])opts[3].text=t.q1_c;}
  const timelineEl=document.getElementById("timeline");
  if(timelineEl){const opts=timelineEl.options;if(opts[0])opts[0].text=t.q2_ph;if(opts[1])opts[1].text=t.q2_a;if(opts[2])opts[2].text=t.q2_b;if(opts[3])opts[3].text=t.q2_c;if(opts[4])opts[4].text=t.q2_d;}
  document.querySelector('.w').style.direction=l==="ur"?"rtl":"ltr";
  if(results.length)render();

  // Homepage (index.html) translations. HPT is only defined when
  // i18n-homepage.js is loaded (index.html only) — calculator.html has no
  // matching element IDs, so this block is a silent no-op there.
  if(typeof HPT!=='undefined' && HPT[l]){
    const hp=HPT[l];
    Object.keys(hp).forEach(id=>{
      const el=document.getElementById(id);
      if(!el) return;
      // heroHeading carries an inline <span class="accent"> — every other
      // key is plain text, so innerHTML is only needed there.
      if(id==='heroHeading') el.innerHTML=hp[id];
      else el.textContent=hp[id];
    });
  }
}

function toggleTooltip(e,id){
  e.stopPropagation();
  document.querySelectorAll('.tooltip-box').forEach(t=>{if(t.id!==id)t.style.display='none';});
  const t=document.getElementById(id);if(t)t.style.display=t.style.display==='block'?'none':'block';
}
document.addEventListener('click',()=>{document.querySelectorAll('.tooltip-box').forEach(t=>t.style.display='none');});

function filtProp(f,btn){
  activeProp=f;
  ['pt-all','pt-condo','pt-town','pt-semi','pt-detached'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
  if(btn) btn.classList.add('on');
  render();
}
function filtFit(f,btn){ activeFit='all'; render(); }
function filt(f,btn){filtFit(f,btn);}

function updateCardCosts(cityId,cityName,propType){
  const x=results.find(r=>r.n===cityName);if(!x)return;
  const price=getPriceForType(cityName,propType,buyPower)||x.homePrice;
  const c=calcCosts(x,price,fam_selected,dn_selected,propType);
  document.getElementById(cityId+'-price').textContent=fc(price);
  document.getElementById(cityId+'-mort').textContent=fc(c.mort)+'/mo';
  document.getElementById(cityId+'-tax').textContent=fc(c.tax)+'/mo';
  document.getElementById(cityId+'-ins').textContent=fc(c.ins)+'/mo';
  document.getElementById(cityId+'-util').textContent=fc(c.util)+'/mo';
  document.getElementById(cityId+'-maint').textContent=fc(c.maint)+'/mo';
  if(document.getElementById(cityId+'-condo-fee')){
    document.getElementById(cityId+'-condo-fee').textContent=c.condoFee>0?fc(c.condoFee)+'/mo':'—';
    document.getElementById(cityId+'-condo-fee-row').style.display=c.condoFee>0?'':'none';
  }
  document.getElementById(cityId+'-total').textContent=fc(c.total)+'/mo';
  document.getElementById(cityId+'-mtotal').textContent=fc(c.total)+'/mo';
  document.getElementById(cityId+'-mmort').textContent='Mortgage: '+fc(c.mort)+'/mo';
  document.querySelectorAll('[data-city="'+cityId+'"]').forEach(b=>{b.style.background=b.dataset.type===propType?'#1D9E75':'#f0fdf8';b.style.color=b.dataset.type===propType?'#fff':'#1D9E75';});
}

function toggle(id){
  const el=document.getElementById(id);
  if(el){
    el.classList.toggle("open");
  }
}

// Links to #cities and #listings (the nav's "Cities", the footer's "City
// Discovery", "Listings" and city names) used to point at anchors that did not
// exist anywhere (REVIEW_BACKLOG.md P0-4). They now land on the FAQ answers
// about coverage and listings; this opens the answer they land on.
function openFaqFromHash(){
  const id = (window.location.hash || '').slice(1);
  if(!id) return;
  const item = document.getElementById(id);
  if(!item || !item.classList || !item.classList.contains('faq-item') || item.classList.contains('open')) return;
  const btn = item.querySelector('.faq-q');
  if(btn) toggleFaq(btn);
}
window.addEventListener('hashchange', openFaqFromHash);
document.addEventListener('DOMContentLoaded', openFaqFromHash);

function toggleFaq(btn){
  // Accordion: clicking an open question closes it; clicking a closed one
  // opens it and closes any other currently-open item (matches v0's
  // single-open-index behavior). Purely presentational — no app state.
  const item = btn.closest('.faq-item');
  if(!item) return;
  const wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(function(el){
    el.classList.remove('open');
  });
  if(!wasOpen){
    item.classList.add('open');
  }
}

// revealCalculator() was removed on 2026-09-22 (audit): it was the only
// function in src/ defined and never called. It revealed a hidden calculator
// from a desktop hero CTA, but index.html no longer has a calculator at all
// and calculator.html shows it immediately (.calculator-section{display:block
// !important}). No HTML references it. The matching .revealed/.animate-in CSS
// in both pages is now unreachable too, and can go with the index/calculator
// de-duplication.


// The lead form's required fields (added 2026-09-23, REVIEW_BACKLOG.md P1-12).
// "Send me homes in my budget" used to do nothing at all when the name or
// email was empty -- no message, no highlight -- so a buyer at the moment of
// intent could reasonably conclude the site was broken. Returns the message
// shown (empty when the fields are fine) and marks the bad fields.
function checkLeadFields(){
  const nmEl=document.getElementById("nm"), emEl=document.getElementById("em");
  const nm=String((nmEl&&nmEl.value)||"").trim(), em=String((emEl&&emEl.value)||"").trim();
  const t=(typeof T!=='undefined'&&T[lang])||{};
  const nameOk=!!nm, emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
  let msg="";
  if(!nm||!em) msg=t.lead_missing||"Please enter your name and email so Sandeep can send you homes.";
  else if(!emailOk) msg=t.lead_bad_email||"That email address doesn't look complete. Please check it.";
  if(nmEl&&nmEl.setAttribute) nmEl.setAttribute("aria-invalid",String(!nameOk));
  if(emEl&&emEl.setAttribute) emEl.setAttribute("aria-invalid",String(!emailOk));
  const errEl=document.getElementById("leadFieldErr");
  if(errEl){ errEl.textContent=msg; errEl.style.display=msg?"block":"none"; }
  return msg;
}

function showTransparencyModal(){
  // Same required-field guard sub() applies, checked here first so the modal
  // doesn't pop up for an incomplete form -- and now says why.
  if(checkLeadFields()) return;
  const ov=document.getElementById('transparencyModalOverlay');
  if(ov){ ov.style.display='flex'; }
}
function closeTransparencyModal(){
  const ov=document.getElementById('transparencyModalOverlay');
  if(ov){ ov.style.display='none'; }
}

// Desktop header scroll behavior: transparent-over-hero until the user
// scrolls past 12px, then white/blurred with a border — matches v0's
// navbar.tsx scroll threshold exactly. Only relevant at >=1024px (where the
// header becomes position:fixed via CSS); harmless no-op below that width
// since the class has no effect on the mobile in-flow header.
(function(){
  function updateHeaderScrollState(){
    const hdr = document.getElementById('mainHdr');
    if(!hdr) return;
    if(window.scrollY > 12){ hdr.classList.add('scrolled'); }
    else { hdr.classList.remove('scrolled'); }
  }
  window.addEventListener('scroll', updateHeaderScrollState, { passive: true });
  document.addEventListener('DOMContentLoaded', updateHeaderScrollState);
  updateHeaderScrollState();
})();

// ── HOW THIS WORKS MODAL ────────────────────────────────────────────────
function startTour(){
  const overlay = document.getElementById('tourOverlay');
  if(overlay) overlay.style.display = 'flex';
}
function endTour(){
  const overlay = document.getElementById('tourOverlay');
  if(overlay) overlay.style.display = 'none';
}
