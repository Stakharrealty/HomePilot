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

function revealCalculator(){
  // Desktop-only reveal: on mobile the calculator is already visible (no CSS
  // rule hides it below the 900px breakpoint), and the hero CTA button itself
  // is hidden on mobile, so this only ever fires from the desktop hero.
  const sec=document.getElementById("calculatorSection");
  if(!sec) return;
  sec.classList.add("revealed");
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      sec.classList.add("animate-in");
      sec.scrollIntoView({behavior:"smooth",block:"start"});
      const inc=document.getElementById("inc");
      if(inc) inc.focus();
    });
  });
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

// ── GUIDED WALKTHROUGH (July 27 2026) ──────────────────────────────────
// A simple, non-AI onboarding tour for the calculator page. Highlights each
// form field in sequence with a tooltip explaining what it's for. Purely
// presentational — does not read or write any real app state (results,
// buyPower, etc.), only walks the user through the form. Auto-shows once
// for first-time visitors (tracked via localStorage), always re-accessible
// via the "How does this work?" button.
const TOUR_STEPS = [
  { id: 'inc', title: 'Start with your income', desc: 'Enter your total household income before taxes. If two people are buying together, add both incomes.' },
  { id: 'dwn', title: 'Your down payment', desc: 'How much you\'ve saved toward a down payment. This affects your mortgage insurance and monthly costs.' },
  { id: 'dbt', title: 'Existing debt (optional)', desc: 'Car loans, credit cards, other monthly payments. Leave at 0 if none — this affects how much a lender would qualify you for.' },
  { id: 'waSelect', title: 'How you work', desc: 'Remote workers get ranked purely by affordability. Hybrid or daily commuters get cities filtered by realistic commute time too.' },
  { id: 'area', title: 'Where you want to live', desc: 'Narrow results to a specific part of Ontario, or leave it broad to see everything you can afford.' },
  { id: 'ftb-yes', title: 'First-time buyer?', desc: 'This can unlock different programs and incentives that affect what you can afford.' },
  { id: 'fam', title: 'Household size', desc: 'Used to estimate realistic living costs and space needs for your household.' },
  { id: 'goBtn', title: 'See your results', desc: 'Once you\'re ready, tap this to see your buying power and ranked Ontario cities on the right.' },
];
let tourIndex = 0;

function getTourTargetCard(stepId){
  const el = document.getElementById(stepId);
  if(!el) return null;
  return el.closest('.card') || el;
}

function positionTourTooltip(target){
  const tooltip = document.getElementById('tourTooltip');
  if(!target || !tooltip) return;
  const rect = target.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset;
  const scrollX = window.scrollX || window.pageXOffset;
  let top = rect.bottom + scrollY + 12;
  let left = rect.left + scrollX;
  // Keep the tooltip on-screen horizontally
  const maxLeft = window.innerWidth - 320;
  if(left > maxLeft) left = Math.max(16, maxLeft);
  // Keep the tooltip on-screen vertically -- clamp defense-in-depth in case
  // positioning ever runs against a stale/mid-scroll rect.
  const tooltipHeight = tooltip.offsetHeight || 160;
  const viewportBottom = scrollY + window.innerHeight;
  if(top + tooltipHeight > viewportBottom){
    top = Math.max(scrollY + 16, viewportBottom - tooltipHeight - 16);
  }
  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';
}

// Polls scrollY until it stabilizes (or a frame cap is hit), so tooltip
// positioning never runs against a mid-scroll stale rect. Falls back to a
// fixed short delay in environments without requestAnimationFrame (older
// browsers, some test harnesses).
function waitForScrollEnd(callback){
  if(typeof requestAnimationFrame !== 'function'){
    setTimeout(callback, 50);
    return;
  }
  let lastY = window.scrollY;
  let stableFrames = 0;
  let frames = 0;
  const maxFrames = 90;
  function check(){
    frames++;
    const y = window.scrollY;
    if(y === lastY){
      stableFrames++;
    } else {
      stableFrames = 0;
      lastY = y;
    }
    if(stableFrames >= 3 || frames >= maxFrames){
      callback();
      return;
    }
    requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
}

function showTourStep(i){
  // querySelectorAll (not querySelector) so no stale highlight from a timing
  // hiccup on the previous step can ever survive a step transition.
  const prevHighlighted = document.querySelectorAll('.tour-highlight');
  prevHighlighted.forEach(function(el){ el.classList.remove('tour-highlight'); });

  const step = TOUR_STEPS[i];
  if(!step) return;
  const target = getTourTargetCard(step.id);
  if(!target) { tourStepNext(); return; }

  target.classList.add('tour-highlight');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  document.getElementById('tourStepNum').textContent = 'Step ' + (i+1) + ' of ' + TOUR_STEPS.length;
  document.getElementById('tourTitle').textContent = step.title;
  document.getElementById('tourDesc').textContent = step.desc;
  document.getElementById('tourBack').style.display = i === 0 ? 'none' : 'inline-block';
  document.getElementById('tourNext').textContent = i === TOUR_STEPS.length - 1 ? 'Got it' : 'Next';

  // Wait for the smooth-scroll to actually finish before reading the target's
  // rect, instead of racing it with a blind fixed delay.
  waitForScrollEnd(() => positionTourTooltip(target));
}

function startTour(){
  tourIndex = 0;
  const overlay = document.getElementById('tourOverlay');
  if(overlay) overlay.style.display = 'block';
  showTourStep(tourIndex);
  try { localStorage.setItem('homepilot_tour_seen', '1'); } catch(e){}
}

function tourStepNext(){
  if(tourIndex >= TOUR_STEPS.length - 1){ endTour(); return; }
  tourIndex++;
  showTourStep(tourIndex);
}

function tourStepBack(){
  if(tourIndex <= 0) return;
  tourIndex--;
  showTourStep(tourIndex);
}

function skipTour(){ endTour(); }

function endTour(){
  const overlay = document.getElementById('tourOverlay');
  if(overlay) overlay.style.display = 'none';
  const highlighted = document.querySelector('.tour-highlight');
  if(highlighted) highlighted.classList.remove('tour-highlight');
}

// Auto-launch once for first-time visitors, small delay so the page settles first.
document.addEventListener('DOMContentLoaded', function(){
  if(!document.getElementById('calculatorSection')) return; // only on the calculator page
  let seen = null;
  try { seen = localStorage.getItem('homepilot_tour_seen'); } catch(e){}
  if(!seen){
    setTimeout(startTour, 900);
  }
});
