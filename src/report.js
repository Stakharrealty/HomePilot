// report.js — HomePilot printable PDF report
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/report.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: downloadReport() (error-wrapped entry point) and
// _downloadReportInner() (builds and opens the HomePilot-branded print window).

function downloadReport() {
  try { _downloadReportInner(); } catch(e) { alert('Report error: ' + e.message + '\n' + e.stack); }
}
function _downloadReportInner() {
  var net = netMonthlyIncome || grossMonthlyIncome * 0.72;
  var TIERS = ['condo','town','semi','detached'];
  var PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};
  var fitColors = {'Good Fit':'pr-badge-g','Moderate':'pr-badge-b','Aggressive':'pr-badge-a','Stretch':'pr-badge-a','High Pressure':'pr-badge-r'};

  function fc(n){ return '$'+(n||0).toLocaleString('en-CA',{maximumFractionDigits:0}); }

  function pctClass(p){
    if(p<=35) return 'pr-badge-g';
    if(p<=45) return 'pr-badge-b';
    if(p<=55) return 'pr-badge-a';
    return 'pr-badge-r';
  }

  var waLabels = {daily:'Daily commuter',hybrid:'Hybrid (2-3 days/wk)',remote:'Remote / Work from home'};

  var profileHTML =
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Gross Income</div><div class="pr-profile-val">'+fc(grossMonthlyIncome*12)+'/yr</div></div>' +
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Down Payment</div><div class="pr-profile-val">'+fc(dn_selected)+'</div></div>' +
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Mortgage Rate</div><div class="pr-profile-val">'+(customMortgageRate*100).toFixed(2)+'%</div></div>' +
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Family Size</div><div class="pr-profile-val">'+fam_selected+' '+(fam_selected==1?'person':'people')+'</div></div>' +
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Work Style</div><div class="pr-profile-val">'+(waLabels[workArrangement]||workArrangement)+'</div></div>' +
    '<div class="pr-profile-item"><div class="pr-profile-lbl">Buying Power</div><div class="pr-profile-val">'+fc(buyPower)+'</div></div>';

  // Use full ranked results list — top 5 unique cities
  if(!results || !results.length) { alert('No results to export — please run your search first.'); return; }
  var seenCities = {};
  var topResults = [];
  for(var i=0; i<results.length && topResults.length<5; i++) {
    if(!seenCities[results[i].n]) {
      seenCities[results[i].n] = true;
      topResults.push(results[i]);
    }
  }
  
  var cityCards = topResults.map(function(x, idx) {
    var pt = PT[x.n] || {};
    var qualifying = TIERS.filter(function(t){ return pt[t] && pt[t] <= buyPower && meetsMinDownPayment(pt[t], dn_selected); });
    if(!qualifying.length) return '';

    var loType = qualifying[0];
    var hiType = qualifying[qualifying.length-1];
    var loC = calcCosts(x, pt[loType], fam_selected, dn_selected, loType);
    var hiC = calcCosts(x, pt[hiType], fam_selected, dn_selected, hiType);
    var loPct = Math.round(loC.total/net*100);
    var hiPct = Math.round(hiC.total/net*100);

    var fitResult = getFit(loC.total, grossMonthlyIncome);
    var fitLabel  = (fitResult && fitResult.lbl) || 'Good Fit';
    var badgeClass = fitColors[fitLabel] || 'pr-badge-g';

    var commuteStr = 'Remote / Work from home';
    if(workArrangement !== 'remote') {
      var cm = calcCommuteMinutes(x.n);
      var tier = getAccessTier(cm);
      commuteStr = cm ? (tier ? tier.label + ' \u00b7 ' + cm + ' min' : cm + ' min') : '';
    }

    var _cm = workArrangement !== 'remote' ? calcCommuteMinutes(x.n) : null;
    var accessTier = _cm ? getAccessTier(_cm) : null;
    var bullets = buildWhyRankedBullets(x, loC, net, accessTier, loType, pt[loType]);
    var bulletsHTML = bullets.map(function(b){ return '<div class="pr-bullet"><span class="pr-bullet-check">\u2713</span>'+b.text+'</div>'; }).join('');

    var ladderRows = qualifying.map(function(tp){
      var c = calcCosts(x, pt[tp], fam_selected, dn_selected, tp);
      var p = Math.round(c.total/net*100);
      return '<div class="pr-ladder-row">' +
        '<span class="pr-ladder-type">'+PLBL[tp]+' \u00b7 '+fc(pt[tp])+'</span>' +
        '<div class="pr-ladder-right">' +
          '<span class="pr-ladder-cost">'+fc(c.total)+'/mo</span>' +
          '<span class="pr-ladder-pct '+pctClass(p)+'">'+p+'%</span>' +
        '</div></div>';
    }).join('');

    var pageBreak = (idx > 0 && idx % 2 === 0) ? ' pr-page-break' : '';

    return '<div class="pr-city-card'+pageBreak+'">' +
      '<div class="pr-city-header">' +
        '<div>' +
          '<div class="pr-city-name">'+x.n+'</div>' +
          '<div class="pr-city-sub">'+commuteStr+'</div>' +
        '</div>' +
        '<span class="pr-city-badge '+badgeClass+'">'+fitLabel+'</span>' +
      '</div>' +
      '<div class="pr-city-body">' +
        '<div class="pr-range-row">' +
          '<span class="pr-range-lbl">Monthly range</span>' +
          '<span class="pr-range-val">'+fc(loC.total)+' \u2013 '+fc(hiC.total)+'<span style="font-size:12px;color:#999">/mo</span></span>' +
        '</div>' +
        '<div class="pr-range-row" style="margin-bottom:14px">' +
          '<span class="pr-range-lbl">Burden range</span>' +
          '<span style="font-size:14px;font-weight:700;color:#555">'+loPct+'% \u2013 '+hiPct+'% of take-home</span>' +
        '</div>' +
        '<div class="pr-bullets">'+bulletsHTML+'</div>' +
        '<div class="pr-ladder">' +
          '<div class="pr-ladder-title">Property ladder</div>' +
          ladderRows +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  if(!cityCards.trim()) { alert('DEBUG: cityCards empty. topResults: ' + topResults.length + ' first city: ' + (topResults[0]&&topResults[0].n) + ' PT entry: ' + (PT[topResults[0]&&topResults[0].n] ? Object.keys(PT[topResults[0].n]).join(',') : 'none')); return; }
  var dateStr = new Date().toLocaleDateString('en-CA', {year:'numeric',month:'long',day:'numeric'});

  var reportHTML =
    '<div class="pr-header">' +
      '<div>' +
        '<div class="pr-logo">Home<span>Pilot</span></div>' +
        '<div style="font-size:12px;color:#555;margin-top:2px">Your personalized home affordability report</div>' +
      '</div>' +
      '<div class="pr-date">Generated '+dateStr+'</div>' +
    '</div>' +
    '<div class="pr-section-title">Your Profile</div>' +
    '<div class="pr-profile">'+profileHTML+'</div>' +
    '<div class="pr-section-title">Top City Matches</div>' +
    cityCards +
    '<div class="pr-agent">' +
      '<div>' +
        '<div class="pr-agent-name">Sandeep Takhar</div>' +
        '<div class="pr-agent-sub">RE/MAX Realty Specialists Inc. \u00b7 Brokerage</div>' +
        '<div class="pr-agent-sub">Bolton \u00b7 Caledon \u00b7 Orangeville \u00b7 GTA</div>' +
      '</div>' +
      '<div class="pr-agent-contact">' +
        '<div>myhomepilot.ca</div>' +
        '<div style="margin-top:4px;color:#1D9E75;font-weight:700">Book a free consultation</div>' +
      '</div>' +
    '</div>' +
    '<div class="pr-disclaimer">' +
      'All estimates are for informational purposes only and do not constitute financial, legal, or mortgage advice. ' +
      'Monthly costs use approximate property tax rates, insurance, and maintenance figures. ' +
      'Mortgage payments based on 25-year amortization at the rate shown. CMHC premiums apply where down payment is under 20%. ' +
      'Land Transfer Tax estimates are approximate. Always consult a licensed mortgage professional before any financial decisions. ' +
      'Sandeep Takhar is a licensed real estate salesperson with RE/MAX Realty Specialists Inc., Brokerage.' +
    '</div>';

  // Open report in a new window for clean printing
  var printWin = window.open('', '_blank', 'width=800,height=900');
  printWin.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>HomePilot Report</title><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#1a1a1a}' +
    '.pr-header{border-bottom:3px solid #1D9E75;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end}' +
    '.pr-logo{font-size:22px;font-weight:800;color:#1D9E75;letter-spacing:-0.5px}' +
    '.pr-logo span{color:#1a1a1a}' +
    '.pr-date{font-size:11px;color:#999}' +
    '.pr-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 10px}' +
    '.pr-profile{background:#f4fdf9;border:1px solid #c8edd9;border-radius:10px;padding:14px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px}' +
    '.pr-profile-lbl{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em}' +
    '.pr-profile-val{font-size:14px;font-weight:700;color:#1a1a1a;margin-top:2px}' +
    '.pr-city-card{border:1px solid #e0e0e0;border-radius:12px;margin-bottom:16px;overflow:hidden;page-break-inside:avoid}' +
    '.pr-city-header{background:#1D9E75;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}' +
    '.pr-city-name{font-size:18px;font-weight:800;color:#fff}' +
    '.pr-city-sub{font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px}' +
    '.pr-city-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px}' +
    '.pr-badge-g{background:#E1F5EE;color:#085041}' +
    '.pr-badge-b{background:#E6F1FB;color:#0C447C}' +
    '.pr-badge-a{background:#FAEEDA;color:#633806}' +
    '.pr-badge-r{background:#FCEBEB;color:#791F1F}' +
    '.pr-city-body{padding:14px 16px}' +
    '.pr-range-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}' +
    '.pr-range-lbl{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.06em}' +
    '.pr-range-val{font-size:17px;font-weight:800;color:#1a1a1a}' +
    '.pr-bullets{margin-bottom:12px}' +
    '.pr-bullet{display:flex;gap:6px;font-size:12px;color:#444;margin-bottom:5px}' +
    '.pr-bullet-check{color:#1D9E75;font-weight:700;flex-shrink:0}' +
    '.pr-ladder{border-top:1px solid #f0f0f0;padding-top:10px}' +
    '.pr-ladder-title{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}' +
    '.pr-ladder-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f5f5f5;font-size:12px}' +
    '.pr-ladder-row:last-child{border-bottom:none}' +
    '.pr-ladder-type{color:#555}' +
    '.pr-ladder-right{display:flex;gap:10px;align-items:center}' +
    '.pr-ladder-cost{font-weight:700;color:#1a1a1a}' +
    '.pr-ladder-pct{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px}' +
    '.pr-agent{margin-top:20px;background:#f4fdf9;border:1px solid #c8edd9;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}' +
    '.pr-agent-name{font-size:15px;font-weight:800;color:#1D9E75}' +
    '.pr-agent-sub{font-size:11px;color:#555;margin-top:2px}' +
    '.pr-agent-contact{text-align:right;font-size:11px;color:#555}' +
    '.pr-disclaimer{font-size:10px;color:#aaa;line-height:1.6;margin-top:24px;border-top:1px solid #f0f0f0;padding-top:12px}' +
    '@media print{@page{margin:15mm 12mm;size:A4 portrait}.pr-city-card{page-break-inside:avoid}body{-webkit-print-color-adjust:exact}}' +
    '</style></head><body>' + reportHTML + '</body></html>');
  printWin.document.close();
  printWin.focus();
  setTimeout(function(){ printWin.print(); }, 400);
}
