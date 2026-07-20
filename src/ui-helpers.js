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
  const waSelectEl=document.getElementById('waSelect');
  if(waSelectEl&&waSelectEl.options.length>=3){
    waSelectEl.options[0].text=t.wa_remote||'Remote';
    waSelectEl.options[1].text=t.wa_hybrid||'Hybrid (2–4 days/week)';
    waSelectEl.options[2].text=t.wa_daily||'Daily (5+ days/week)';
  }
  const textIds=[["ht","ht"],["hs","hs"],["l1","l1"],["l2","l2"],["l3","l3"],["l4","l4"],["l5","l5"],["bt","bt"],["ctt","ctt"],["ctp","ctp"],["st","st"],["dtt","dtt"],["dtp","dtp"],["bp_lbl","bp_lbl"],["bp_sub_txt","bp_sub"],["cities_title_el","cities_title"]];
  textIds.forEach(([id,k])=>{const el=document.getElementById(id);if(el&&t[k])el.innerHTML=t[k];});
  const l3inc=document.getElementById("l3_inc");if(l3inc)l3inc.textContent=t.l3_inc;
  const l3exc=document.getElementById("l3_exc");if(l3exc)l3exc.textContent=t.l3_exc;
  const l3zero=document.getElementById("l3_zero");if(l3zero)l3zero.textContent=t.l3_zero;
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

function showTransparencyModal(){
  // Same required-field guard sub() already applies, checked here too so the modal
  // doesn't pop up for an incomplete form.
  const nm=document.getElementById("nm").value, em=document.getElementById("em").value;
  if(!nm||!em) return;
  const ov=document.getElementById('transparencyModalOverlay');
  if(ov){ ov.style.display='flex'; }
}
function closeTransparencyModal(){
  const ov=document.getElementById('transparencyModalOverlay');
  if(ov){ ov.style.display='none'; }
}
