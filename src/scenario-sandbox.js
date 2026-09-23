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

// CHANGED 2026-09-23 (IMPROVEMENT_PLAN.md 1.4: "one scoring function for the
// screen, the lead and the scenarios"). The What-If used getAnglePicks(), a
// third weighted blend no other part of the app used, so "Best Overall" here
// could name a different city from #1 on screen. It now runs rankCities() --
// the same rule, commute limit and candidate list as the results -- and
// reports its #1 under each of the three sorts. Two scenario-only bugs went
// with it: take-home pay was a flat 72% of gross instead of
// estimateOntarioNetAnnual(), and the buyer's monthly debt was dropped.
function _getAngleSnapshot(income, dn, wa, zone) {
  // Run the ranking against a hypothetical scenario WITHOUT mutating the
  // buyer's real saved scenario permanently.
  var savedWA = workArrangement, savedZone = workZone, savedGross = grossMonthlyIncome,
      savedNet = netMonthlyIncome, savedDn = dn_selected, savedBP = buyPower, savedCBP = comfortBuyPower;
  var picks = null, bp = null;
  var limit = maxCommuteTouched ? maxCommuteMin : (DEFAULT_MAX_COMMUTE[wa] || null);
  try {
    workArrangement = wa;
    workZone = wa === 'remote' ? null : zone;
    grossMonthlyIncome = income/12;
    // Same split between the two earners as the buyer entered (2026-09-23).
    netMonthlyIncome = householdNetAnnual(income)/12;
    dn_selected = dn;
    bp = calcBP(income, dn, existingDebt);
    buyPower = bp.bp;
    comfortBuyPower = bp.comfortBP;
    var areaEl = document.getElementById('area');
    var cands = candidateCities(areaEl && areaEl.value ? areaEl.value : 'all', bp.bp);
    var first = function(sort){ return rankCities(cands, { sort: sort, maxCommute: limit, onlyType: null }).ranked[0] || null; };
    var home = first('home');
    if (home) picks = { home: home, commute: (wa !== 'remote' && workZone) ? first('commute') : null, cost: first('cost') };
  } finally {
    // Restore the buyer's real scenario
    workArrangement = savedWA; workZone = savedZone;
    grossMonthlyIncome = savedGross; netMonthlyIncome = savedNet;
    dn_selected = savedDn; buyPower = savedBP; comfortBuyPower = savedCBP;
  }
  return { picks: picks, buyPower: bp ? bp.bp : 0, limit: limit };
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

  // beforePick / afterPick are rankCities() entries: { n, type, price, costs, ... }.
  function angleRow(label, beforePick, afterPick) {
    if(!beforePick && !afterPick) return '';
    var bCity = beforePick ? beforePick.n : '—';
    var aCity = afterPick  ? afterPick.n  : '—';
    var bType = beforePick ? PLBL[beforePick.type] : '';
    var aType = afterPick  ? PLBL[afterPick.type]  : '';
    var bPrice = beforePick ? fc(beforePick.price) + ' · ' + fc(beforePick.costs.total) + '/mo' : '';
    var aPrice = afterPick  ? fc(afterPick.price)  + ' · ' + fc(afterPick.costs.total)  + '/mo' : '';
    var changed = bCity !== aCity || bType !== aType;
    var tierUp = beforePick && afterPick && (HOME_RANK[afterPick.type]||0) > (HOME_RANK[beforePick.type]||0);

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
      html += '<div style="font-size:11px;color:#8B6CA8;background:#F3EEF9;border-radius:8px;padding:8px 10px;margin-bottom:10px">Work style changed to '+newWA+' — '+(after.limit ? 'places past a '+after.limit+'-minute drive are set aside.' : 'no commute limit applies.')+'</div>';
    }
    // The #1 place under each of the results page's three sorts.
    html += angleRow('Your #1 place', before.picks ? before.picks.home : null, after.picks.home);
    html += angleRow('Shortest commute', before.picks ? before.picks.commute : null, after.picks.commute);
    html += angleRow('Lowest monthly cost', before.picks ? before.picks.cost : null, after.picks.cost);
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
