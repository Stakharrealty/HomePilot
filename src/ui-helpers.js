// ui-helpers.js — HomePilot small UI interaction helpers
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/ui-helpers.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: toggleTooltip() + its document click-listener (closes open
// tooltips on outside click — safe to load early since it only touches
// `document` itself, not specific elements that need to exist first),
// filtProp(), filtFit(), filt(), updateCardCosts() (property-type/fit filter
// UI), toggle() (generic card expand/collapse).
//
// setLang() (the language menu) was removed on 2026-09-23: the site is
// English only (IMPROVEMENT_PLAN.md 2.4b).

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

// ── WHATSAPP NOTE ON PHONES (IMPROVEMENT_PLAN.md 2.10) ──────────────────
// The floating WhatsApp button on index.html and calculator.html (#waWrap)
// carries a "Questions about your analysis?" note (#waTooltip) 210px wide.
// On a 375px phone that is more than half the screen, and it sat over the
// stats, the form and the result cards until the buyer found its small close
// button. On phones (under 600px, the site's own phone breakpoint) the note
// now steps aside the first time the page scrolls; the green button stays
// where it is. Wider screens keep it while the page scrolls, except that on
// the calculator go() hides it once there are results, at every width: it sat
// over the third answer card (2026-09-24). tests/phone_fixes_test.js.
const WA_NOTE_PHONE_QUERY = '(max-width: 599px)';
function hideWaNoteOnPhoneScroll(){
  if(!window.matchMedia || !window.matchMedia(WA_NOTE_PHONE_QUERY).matches) return;
  const note = document.getElementById('waTooltip');
  if(note) note.style.display = 'none';
  window.removeEventListener('scroll', hideWaNoteOnPhoneScroll);
}
window.addEventListener('scroll', hideWaNoteOnPhoneScroll, { passive: true });
