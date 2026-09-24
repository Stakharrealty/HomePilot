// consent.js — HomePilot pre-calculation consent gate
//
// Added September 17, 2026. Intercepts the "Show Me What I Can Afford" button
// so a buyer must explicitly acknowledge the Terms of Use, Privacy Policy and
// Disclaimer before any affordability result is produced.
//
// Deliberately NOT wired inside go() itself:
//   - go() is called directly by tests/smoke_test.js (and, until Share was
//     taken off the page on 2026-09-24, by a shared scenario link). Gating
//     go() would break that.
//   - The gate belongs at the point of user intent (the button click), not
//     inside the calculation engine.
//
// Acceptance is stored in localStorage against a version string. Bumping
// HP_CONSENT_VERSION re-prompts every returning visitor — do that whenever
// the legal copy on the modal or the linked pages materially changes.
//
// Contains: HP_CONSENT_VERSION, HP_CONSENT_KEY, hasHomePilotConsent(),
// recordHomePilotConsent(), requestCalculation(), openConsentModal(),
// closeConsentModal(), onConsentCheckboxChange(), acceptConsentAndCalculate().

const HP_CONSENT_VERSION = '2026-09-17c';
const HP_CONSENT_KEY = 'hp_consent';

// Fallback for browsers where localStorage throws (Safari private mode,
// storage disabled). Consent still gates the first calculation of the
// session, it just isn't remembered across visits.
let hpConsentSessionFallback = false;

function hasHomePilotConsent(){
  if(hpConsentSessionFallback) return true;
  try{
    const raw = window.localStorage.getItem(HP_CONSENT_KEY);
    if(!raw) return false;
    const rec = JSON.parse(raw);
    return !!rec && rec.version === HP_CONSENT_VERSION;
  }catch(e){
    return false;
  }
}

function recordHomePilotConsent(){
  hpConsentSessionFallback = true;
  try{
    window.localStorage.setItem(HP_CONSENT_KEY, JSON.stringify({
      version: HP_CONSENT_VERSION,
      acceptedAt: new Date().toISOString()
    }));
  }catch(e){
    // Storage unavailable — session fallback above already covers this visit.
  }
}

// Entry point for the Go button. Runs the calculation immediately for anyone
// who has already accepted the current version; otherwise opens the gate.
//
// A buyer who hasn't answered "Work arrangement" or "First-time buyer" (no
// answer is pre-selected; IMPROVEMENT_PLAN.md 2.5) is shown what's missing
// before the consent pop-up, not after it. With consent already given, go()
// makes the same check alongside the other form checks.
function requestCalculation(){
  if(hasHomePilotConsent()){ go(); return; }
  if(typeof checkRequiredChoices === 'function' && !checkRequiredChoices()){
    if(typeof showFirstUnansweredChoice === 'function') showFirstUnansweredChoice();
    return;
  }
  openConsentModal();
}

function openConsentModal(){
  const ov = document.getElementById('consentModalOverlay');
  if(!ov){ // Fail open rather than trapping the user with no way forward.
    go();
    return;
  }
  const cb = document.getElementById('consentCheckbox');
  if(cb) cb.checked = false;
  onConsentCheckboxChange();
  ov.style.display = 'flex';
  const btn = document.getElementById('consentAcceptBtn');
  if(btn) btn.focus();
}

function closeConsentModal(){
  const ov = document.getElementById('consentModalOverlay');
  if(ov) ov.style.display = 'none';
}

function onConsentCheckboxChange(){
  const cb = document.getElementById('consentCheckbox');
  const btn = document.getElementById('consentAcceptBtn');
  if(!btn) return;
  const ok = !!(cb && cb.checked);
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.45';
  btn.style.cursor = ok ? 'pointer' : 'not-allowed';
}

function acceptConsentAndCalculate(){
  const cb = document.getElementById('consentCheckbox');
  if(!cb || !cb.checked) return;
  recordHomePilotConsent();
  closeConsentModal();
  go();
}

document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  const ov = document.getElementById('consentModalOverlay');
  if(ov && ov.style.display === 'flex') closeConsentModal();
});
