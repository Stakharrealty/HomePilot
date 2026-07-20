// scenario-sandbox.js — HomePilot "what-if" scenario comparison tool
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/scenario-sandbox.js"></script> before
// the main inline script, same shared global scope as before.
//
// Contains: _scnWA / _beforeSnapshot (sandbox-local state), openScenarioSandbox(),
// closeScenarioSandbox(), setScenarioWA(), scenarioPreview(),
// _getAngleSnapshot(), runScenarioComparison(), syncRate(). This feature
// temporarily reads/mutates shared global state (buyPower, workArrangement,
// etc.) to compute what-if comparisons, then restores it — unchanged behavior
// from before extraction.

var _scnWA = null; // pending work arrangement in sandbox
var _beforeSnapshot = null; // captured when sandbox opens

function openScenarioSandbox() {
  var panel = document.getElementById('scenarioPanel');
  if(!panel) return;
  // Toggle — if already open, close it
  if(panel.style.display === 'block') {
    panel.style.display = 'none';
    return;
  }
  // Capture the BEFORE snapshot now — before any inputs change
  _beforeSnapshot = _getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, workZone);
  // Pre-fill fields with current values
  document.getElementById('scnInc').value = Math.round(grossMonthlyIncome*12);
  document.getElementById('scnDn').value  = dn_selected;
  _scnWA = workArrangement;
  setScenarioWA(workArrangement);
  panel.style.display = 'block';
  document.getElementById('scenarioResults').innerHTML = '';
}

function closeScenarioSandbox() {
  var panel = document.getElementById('scenarioPanel');
  if(panel) panel.style.display = 'none';
}

function setScenarioWA(wa) {
  _scnWA = wa;
  ['daily','hybrid','remote'].forEach(function(w){
    var btn = document.getElementById('scnWa' + w.charAt(0).toUpperCase() + w.slice(1));
    if(btn) btn.classList.toggle('on', w === wa);
  });
}

function scenarioPreview() {
  // Live-typing feedback could go here later; comparison runs on button tap for now.
}

function _getAngleSnapshot(income, dn, wa, zone) {
  // Run the angle-picking engine against a hypothetical scenario WITHOUT
  // mutating the buyer's real saved scenario permanently.
  var savedWA = workArrangement, savedZone = workZone, savedGross = grossMonthlyIncome,
      savedNet = netMonthlyIncome, savedDn = dn_selected, savedBP = buyPower, savedCBP = comfortBuyPower;

  workArrangement = wa;
  workZone = zone;
  grossMonthlyIncome = income/12;
  netMonthlyIncome = income/12*0.72;
  dn_selected = dn;
  var bp = calcBP(income, dn, 0);
  buyPower = bp.bp;
  comfortBuyPower = bp.comfortBP;

  var picks = getAnglePicks(M);

  // Restore the buyer's real scenario
  workArrangement = savedWA; workZone = savedZone;
  grossMonthlyIncome = savedGross; netMonthlyIncome = savedNet;
  dn_selected = savedDn; buyPower = savedBP; comfortBuyPower = savedCBP;

  return { picks: picks, buyPower: bp.bp, net: income/12*0.72 };
}

function runScenarioComparison() {
  var newInc = parseFloat(document.getElementById('scnInc').value) || (grossMonthlyIncome*12);
  var newDn  = parseFloat(document.getElementById('scnDn').value)  || dn_selected;
  var newWA  = _scnWA || workArrangement;

  // Validate the hypothetical down payment against the hypothetical scenario's cheapest property
  if(newDn <= 0) {
    document.getElementById('scenarioResults').innerHTML =
      '<div style="font-size:12px;color:#991B1B;padding:10px;background:#FEF2F2;border-radius:8px">A down payment is required.</div>';
    return;
  }

  var zone = workZone; // keep same work location for the what-if
  var before = _beforeSnapshot || _getAngleSnapshot(grossMonthlyIncome*12, dn_selected, workArrangement, zone);
  var after  = _getAngleSnapshot(newInc, newDn, newWA, zone);
  var waChanged = newWA !== workArrangement;

  var PLBL = {detached:'Detached',semi:'Semi-Detached',town:'Townhouse',condo:'Condo'};
  var tierRank = {detached:4,semi:3,town:2,condo:1};

  function angleRow(label, beforePick, afterPick, useLow) {
    if(!beforePick && !afterPick) return '';
    var bCity = beforePick ? beforePick.city.n : '—';
    var aCity = afterPick  ? afterPick.city.n  : '—';
    var bType = beforePick ? PLBL[useLow ? (beforePick.lowestType||beforePick.bestType) : beforePick.bestType] : '';
    var aType = afterPick  ? PLBL[useLow ? (afterPick.lowestType||afterPick.bestType)   : afterPick.bestType]  : '';
    var bPrice = beforePick ? fc(useLow ? (beforePick.lowestPrice||beforePick.bestPrice) : beforePick.bestPrice) : '';
    var aPrice = afterPick  ? fc(useLow ? (afterPick.lowestPrice||afterPick.bestPrice)   : afterPick.bestPrice)  : '';
    var changed = bCity !== aCity || bType !== aType;
    var tierUp = beforePick && afterPick && (tierRank[afterPick.bestType]||0) > (tierRank[beforePick.bestType]||0);

    return '<div style="background:#fff;border:1px solid '+(changed?'#C9B3E5':'#eee')+';border-radius:10px;padding:12px 14px;margin-bottom:8px">'+
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8B6CA8;margin-bottom:8px">'+label+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">'+
        '<div>'+
          '<div style="font-size:10px;color:#999">Now</div>'+
          '<div style="font-size:13px;font-weight:700;color:#666">'+bCity+'</div>'+
          '<div style="font-size:11px;color:#999">'+bType+' · '+bPrice+'</div>'+
        '</div>'+
        '<div style="color:#8B6CA8;font-size:16px">→</div>'+
        '<div>'+
          '<div style="font-size:10px;color:#999">What If</div>'+
          '<div style="font-size:13px;font-weight:800;color:'+(changed?'#5B3A7E':'#666')+'">'+aCity+'</div>'+
          '<div style="font-size:11px;color:'+(changed?'#5B3A7E':'#999')+'">'+aType+' · '+aPrice+
            (tierUp?' <span style="color:#085041;font-weight:700">↑ Unlocked</span>':'')+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  var html = '';
  if(!before.picks && !after.picks) {
    html = '<div style="font-size:12px;color:#666;padding:10px;background:#fff;border-radius:8px">Neither scenario has qualifying cities — try a higher income or larger down payment.</div>';
  } else if(!after.picks) {
    html = '<div style="font-size:12px;color:#991B1B;padding:10px;background:#FEF2F2;border-radius:8px">This scenario does not unlock any cities within comfort range. Try adjusting the numbers.</div>';
  } else {
    if(waChanged) {
      html += '<div style="font-size:11px;color:#8B6CA8;background:#F3EEF9;border-radius:8px;padding:8px 10px;margin-bottom:10px">Work style changed to '+newWA+' — ranking weights have shifted accordingly.</div>';
    }
    html += angleRow('⭐ Best Overall', before.picks ? before.picks.overall : null, after.picks.overall, false);
    html += angleRow('🏡 Most House',   before.picks ? before.picks.house   : null, after.picks.house,   false);
    html += angleRow('🗽 Most Financial Freedom', before.picks ? before.picks.value : null, after.picks.value, true);
  }

  document.getElementById('scenarioResults').innerHTML = html;
}

// shareScenario(), flashShareBtn(), loadScenarioFromURL() now live in
// src/scenario-share.js — loaded via <script src>.

function syncRate(val, source) {
  const v = parseFloat(val);
  if(isNaN(v) || v < 0.5 || v > 20) return;
  customMortgageRate = v / 100;
  if(source === 'slider') {
    document.getElementById('rateInput').value = v.toFixed(2);
  } else {
    document.getElementById('rateSlider').value = v;
  }
  // Update hint label
  const base = DEFAULT_MORTGAGE_RATE_PCT;
  const diff = (v - base).toFixed(2);
  const hint = v === base ? 'Current market rate' :
    (v < base ? '▼ ' + Math.abs(diff) + '% below market' : '▲ ' + diff + '% above market');
  const hintEl = document.getElementById('rateHint');
  if(hintEl) hintEl.textContent = hint;
  // Re-render costs live
  if(results && results.length > 0) render();
}
