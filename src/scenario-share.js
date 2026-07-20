// scenario-share.js — HomePilot "share your scenario" feature
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/scenario-share.js"></script> before the
// main inline script, same shared global scope as before.
//
// Contains: shareScenario() (calls the homepilot-scenario-share Worker's
// POST /save, builds a short myhomepilot.ca?s=<id> link — this is the fix for
// Bug 2, Base64 financial data in share URLs), flashShareBtn() (small UI
// feedback helper used by shareScenario, kept together since it's only used
// there), and loadScenarioFromURL() (calls GET /load?id= to restore a shared
// scenario).

async function shareScenario() {
  try {
    const payload = {
      inc:  parseFloat(document.getElementById('inc').value)  || 0,
      dn:   parseFloat(document.getElementById('dwn').value)  || 0,
      dbt:  parseFloat(document.getElementById('dbt').value)  || 0,
      fam:  document.getElementById('fam').value,
      wa:   workArrangement,
      wp:   (document.getElementById('workPostal')?.value || '').trim().toUpperCase(),
      rate: parseFloat((customMortgageRate * 100).toFixed(2)),
    };

    // Scenario data is stored server-side (Cloudflare KV via homepilot-scenario-share
    // Worker) and the link only ever carries a short random ID — income, debt, and
    // work postal code never travel in the URL itself. Previously this was Base64-
    // encoded directly into the link, which is NOT encryption and was trivially
    // decodable by anyone who saw it. Fixed July 2026.
    const res = await fetch("https://homepilot-scenario-share.stakharrealty.workers.dev/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if(!data.ok || !data.id) throw new Error('save_failed');

    const url = 'https://myhomepilot.ca' + '?s=' + data.id;
    const shareText = "Here's my home buying scenario — take a look and tell me what you think";
    // Use native share sheet on mobile (WhatsApp, iMessage, etc.)
    if(navigator.share) {
      navigator.share({ title: 'My HomePilot Scenario', text: shareText, url: url })
        .then(() => flashShareBtn())
        .catch(() => {}); // user cancelled — do nothing
    } else {
      // Desktop fallback — copy to clipboard
      if(navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => flashShareBtn());
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        flashShareBtn();
      }
    }
  } catch(e) {
    console.error('Share failed', e);
    const lbl = document.getElementById('shareBtnLbl');
    if(lbl){ lbl.textContent = 'Try again'; setTimeout(() => { lbl.textContent = 'Share'; }, 2500); }
  }
}

function flashShareBtn() {
  const lbl = document.getElementById('shareBtnLbl');
  const btn = document.getElementById('shareBtn');
  if(!lbl || !btn) return;
  lbl.textContent = 'Copied!';
  btn.style.background = '#1D9E75';
  btn.style.color = '#fff';
  setTimeout(() => {
    lbl.textContent = 'Share';
    btn.style.background = '#fff';
    btn.style.color = '#1D9E75';
  }, 2500);
}

async function loadScenarioFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    if(!s) return;

    // 's' is a short opaque ID pointing at server-side (Cloudflare KV) storage —
    // no financial data is decoded from the URL itself. Fails silently if the
    // link is malformed, unrecognized, or has expired (links expire after 180 days).
    const res = await fetch("https://homepilot-scenario-share.stakharrealty.workers.dev/load?id=" + encodeURIComponent(s));
    if(!res.ok) return;
    const p = await res.json().catch(() => null);
    if(!p) return;

    if(p.inc)  document.getElementById('inc').value  = p.inc;
    if(p.dn)   document.getElementById('dwn').value  = p.dn;
    if(p.dbt)  document.getElementById('dbt').value  = p.dbt || 0;
    if(p.fam)  document.getElementById('fam').value  = p.fam;
    if(p.wa) {
      workArrangement = p.wa;
      const sel = document.getElementById('waSelect');
      if(sel) sel.value = p.wa;
      setWorkArrangement(p.wa);
    }
    if(p.wp) {
      const wpEl = document.getElementById('workPostal');
      if(wpEl) wpEl.value = p.wp;
    }
    if(p.rate && p.rate !== DEFAULT_MORTGAGE_RATE_PCT) {
      customMortgageRate = p.rate / 100;
    }
    // Auto-run after a tick so DOM is ready
    setTimeout(() => go(), 100);
  } catch(e) { /* invalid or missing — ignore silently */ }
}
