// render.js — HomePilot card rendering
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules) — the final, most tightly-coupled piece of
// the split. Loaded via <script src="src/render.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: render() (draws the results from rankCities() in ranking.js),
// the card builder it uses, and selectPropType() (per-property-type panel
// expansion). They read shared global state (results, activeProp, buyPower,
// workArrangement, etc.) declared in main.js — safe because these are function
// declarations, not executed until called, by which point every script has
// fully loaded in both a real browser and this project's test harness.
//
// REWRITTEN 2026-09-23 (IMPROVEMENT_PLAN.md 1.2, 1.4, 1.5). render() no longer
// scores or orders anything itself; rankCities() does, for every consumer.
// What changed on screen:
//   - The main list holds only cities with a home the buyer can comfortably
//     afford, in the order of the one rule. "N cities match your budget"
//     counts only those (REVIEW_BACKLOG.md P1-5); cities where everything is a
//     stretch get their own section below instead of padding the count.
//   - Cities past the buyer's commute limit are set aside with a note ("8
//     hidden — estimated drive over 60 min. Show them"), never ranked.
//   - Each card states the home it recommends (type, price, monthly cost, % of
//     take-home), which is exactly what shownCards records for the PDF
//     report and Compare.
//   - The commute shows as an estimated drive in minutes, not a tier; the
//     orange "Limited Commute ... long daily drive" box is gone, because the
//     buyer has now said how long a drive they accept.
//   - The property list uses getFit() for its labels and full qualification
//     for which types appear (P1-21): it used its own <35 / <=45 thresholds and
//     checked only the minimum down payment, so a home at 45.3% was "Good" in
//     the list and "Stretch" everywhere else, and a type could appear that
//     failed qualification.

// The Great / Good / Stretch colours, from getFit()'s class. One table, used by
// the card, the property list and the breakdown panel.
const FIT_STYLE = {
  fg: { color: '#085041', bg: '#E1F5EE' },
  fo: { color: '#0C447C', bg: '#E6F1FB' },
  fs: { color: '#633806', bg: '#FAEEDA' },
};

function fitPill(fit) {
  const s = FIT_STYLE[fit.cls] || FIT_STYLE.fo;
  return '<span class="fit-pill" style="background:' + s.bg + ';color:' + s.color + '">' + fit.lbl + '</span>';
}

function render(){
  const t=T.en;
  const ranking=rankCities(results,{sort:resultsSort,maxCommute:maxCommuteMin,onlyType:activeProp!=='all'?activeProp:null});
  const {ranked,stretchOnly,overCommute}=ranking;
  const visibleOver=showOverCommute?overCommute:[];

  // Sort switch: highlight the order in force; "Shortest commute" only exists
  // when there is a commute to sort by.
  RESULT_SORTS.forEach(s=>{
    const b=document.getElementById('sort-'+s);
    if(!b) return;
    if(b.classList) b.classList.toggle('on', s===ranking.sort);
    if(s==='commute') b.style.display=ranking.commuteKnown?'':'none';
  });

  // The results count is set HERE, not in go() (moved 2026-09-22, audit), and
  // since 2026-09-23 it counts only cities with a home the buyer can
  // comfortably afford (REVIEW_BACKLOG.md P1-5). It used to count every city
  // with any option, so "38 cities match your budget" included cities where
  // every option was a Stretch.
  // When nothing within the commute limit is comfortable but places further
  // out are, the commute is the lever to name -- not the down payment.
  const overComfortable=overCommute.filter(e=>e.comfortable).length;
  const limitIsTheReason=!ranked.length&&ranking.limit!==null&&overComfortable>0;
  const typeWord=activeProp==='all'?'a home':'a '+(PROP_LABELS[activeProp]||'home').toLowerCase();
  const cntEl=document.getElementById('cnt');
  if(cntEl){
    const n=ranked.length;
    cntEl.innerHTML=n
      ?'<span>'+n+' '+(n===1?'city':'cities')+'</span> with '+typeWord+' you can comfortably afford — tap a city for the full monthly breakdown'
      :limitIsTheReason
        ?'<span>No cities</span> within a '+ranking.limit+'-minute drive have '+typeWord+' you can comfortably afford — '+overComfortable+' further out do'
        :'<span>No cities</span> with '+typeWord+' you can comfortably afford yet — try adjusting your down payment or home type';
  }

  // The rule in force, plus what was set aside and why.
  const notesEl=document.getElementById('rankNotes');
  if(notesEl){
    const notes=[];
    if(stretchOnly.length) notes.push(stretchOnly.length+(ranked.length?' more ':' ')+(stretchOnly.length===1?'city works':'cities work')+' only as a stretch — listed below'+(ranked.length?' the others.':'.'));
    if(ranking.limit!==null&&overCommute.length) notes.push(overCommute.length+' '+(overCommute.length===1?'city':'cities')+' hidden — estimated drive over '+ranking.limit+' min'+(overComfortable?' ('+overComfortable+' with '+typeWord+' you can comfortably afford)':'')+'. <button type="button" class="link-btn" onclick="toggleOverCommute()">'+(showOverCommute?'Hide them':'Show them')+'</button>');
    if(workArrangement!=='remote'&&!workZone) notes.push("We couldn't place your work location, so commute isn't used below. Check the work city or postal code.");
    notesEl.innerHTML='<div class="rank-rule">'+rankRuleSentence(ranking.sort,ranking.commuteKnown)+'</div>'+notes.map(x=>'<div class="rank-note">'+x+'</div>').join('');
  }

  // #topPicks used to hold renderAnglePicks()'s "Outside Your Comfort Range"
  // box; the stretch section below replaces it.
  const tpEl=document.getElementById('topPicks');
  if(tpEl) tpEl.innerHTML='';

  const el=document.getElementById('list');
  const more=document.getElementById('listMore');
  const rateBarEl=document.getElementById('rateBar');
  const shareBarEl=document.getElementById('shareBar');
  const anyCards=ranked.length+stretchOnly.length+visibleOver.length>0;

  if(el){
    if(ranked.length){
      el.innerHTML=ranked.map(e=>cityCardHtml(e,'ranked')).join('');
    } else {
      const pn={all:'any home',condo:'a condo',town:'a townhouse',semi:'a semi-detached home',detached:'a detached home'}[activeProp]||'any home';
      const where=limitIsTheReason?' within a '+ranking.limit+'-minute drive':'';
      const hint=limitIsTheReason?'A longer commute limit, or "Show them" above, brings in the places further out.':t.no_results3;
      el.innerHTML='<div style="font-size:13px;color:#999;padding:16px 0;text-align:center;">No city'+where+' has '+pn+' you can comfortably afford'+(stretchOnly.length?' — the closest options are below.':'.')+'<br><span style="font-size:12px;">'+hint+'</span></div>';
    }
  }
  if(more){
    let h='';
    if(stretchOnly.length){
      h+='<div class="more-section"><div class="sec-title">Only as a stretch</div>'+
        '<div class="count">A bank may lend enough for these, but nothing here is comfortable: every option is above your comfort range or would take 45% or more of your take-home pay.</div>'+
        stretchOnly.map(e=>cityCardHtml(e,'stretch')).join('')+'</div>';
    }
    if(visibleOver.length){
      h+='<div class="more-section"><div class="sec-title">Past your '+ranking.limit+'-minute commute limit</div>'+
        '<div class="count">Shown because you asked. They are not ranked with the others.</div>'+
        visibleOver.map(e=>cityCardHtml(e,'over')).join('')+'</div>';
    }
    more.innerHTML=h;
  }

  // The on-screen record the PDF report (report.js) and Compare (compare.js)
  // are built from (IMPROVEMENT_PLAN.md 1.2): every card just drawn, in screen
  // order, with the exact figures on it.
  shownCards=[
    ...ranked.map(e=>[e,'ranked']),
    ...stretchOnly.map(e=>[e,'stretch']),
    ...visibleOver.map(e=>[e,'over']),
  ].map(([e,section])=>({city:e.n,type:e.type,price:e.price,monthlyCost:e.costs.total,pctOfTakeHome:e.pct,commuteMin:e.commuteMin,fit:e.fit.lbl,section}));

  if(!anyCards){
    if(rateBarEl) rateBarEl.style.display='none';
    if(shareBarEl) shareBarEl.style.display='none';
    return;
  }
  // Show rate bar and sync its inputs to current rate
  if(shareBarEl){ shareBarEl.style.display='flex'; }
  if(rateBarEl) {
    rateBarEl.style.display='block';
    const currentPct = (customMortgageRate * 100).toFixed(2);
    const sliderEl = document.getElementById('rateSlider');
    const inputEl  = document.getElementById('rateInput');
    if(sliderEl) sliderEl.value = currentPct;
    if(inputEl)  inputEl.value  = currentPct;
    const hintEl = document.getElementById('rateHint');
    if(hintEl) hintEl.textContent = parseFloat(currentPct) === DEFAULT_MORTGAGE_RATE_PCT ? 'Current market rate' : '';
  }
}

// One city card. `e` is a rankCities() entry; `section` is 'ranked', 'stretch'
// or 'over'. Every figure on the card comes from the entry, so the card, the
// ranking and shownCards can never show different numbers.
function cityCardHtml(e, section){
  const t=T.en;
  const x=e.city;
  const id='c-'+x.n.replace(/[^a-zA-Z0-9]/g,'-');
  const displayPrice=e.price;
  const c=e.costs;
  const fit=e.fit;
  const net=netMonthlyIncome||grossMonthlyIncome*0.72;
  const PLBL={condo:'Condos',town:'Townhomes',semi:'Semi-Detached Homes',detached:'Detached Homes'};
  // Estimated drive, as a plain fact. Green when short; the neutral colour
  // otherwise; red only on a card past the buyer's own limit.
  const commuteBadge=e.commuteMin===null?'':
    '<div class="commute-badge'+(section==='over'?' access-limited':e.commuteMin<=25?' access-excellent':'')+'">About '+e.commuteMin+' min drive · estimate</div>';
  let unlockNote='';
  if(section==='stretch'){
    unlockNote='<div style="font-size:12px;color:#996600;margin-top:6px;display:flex;align-items:center;gap:5px"><span>⚠</span>Even the '+(PROP_LABELS[e.type]||'home').toLowerCase()+' here is beyond comfortable</div>';
  } else if(section==='over'){
    unlockNote='<div style="font-size:12px;color:#8C2F2F;margin-top:6px">Over your '+maxCommuteMin+'-minute limit</div>';
  }
  // Every type the buyer can actually buy here (full qualification), for the
  // monthly range and the property list below.
  const options=(activeProp==='all'?['condo','town','semi','detached']:[activeProp])
    .map(tp=>qualifyingOption(x,tp)).filter(Boolean);
  return '<div class="city" id="'+id+'" onclick="toggle(\''+id+'\')">'+
    '<div class="ct"><div><div class="cn">'+x.n+'</div>'+
      '<div class="card-headline">'+(PROP_LABELS[e.type]||e.type)+' · '+fc(displayPrice)+' '+fitPill(fit)+'</div>'+
      commuteBadge+'</div>'+
    '<div style="text-align:right">'+
      '<div style="font-size:10px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">'+t.true_cost+'</div>'+
      '<div style="font-size:17px;font-weight:800;color:#1D9E75;white-space:nowrap" id="'+id+'-mtotal">'+fc(c.total)+'/mo</div>'+
      '<div style="font-size:11px;color:#777;margin-top:2px" id="'+id+'-mmort">'+(e.pct!==null?e.pct+'% of take-home':t.mortgage+': '+fc(c.mort)+'/mo')+'</div>'+
    '</div></div>'+
    unlockNote+
    buildWhyRanked(x, c, net, e.commuteMin, e.type, displayPrice)+
    (devMode?buildDevPanel(e,section):'')+
    (function(){
      // PROPERTY LIST — every type the buyer can actually buy in this city,
      // each with its monthly cost, its share of take-home pay, and getFit()'s
      // label (the same label used everywhere else).
      if(!options.length) return '';
      let h='<div style="font-size:11px;color:#999;margin-top:10px;margin-bottom:6px;text-align:center;letter-spacing:0.01em">Tap a property type to see full cost breakdown</div>';
      h+='<div style="border:1px solid #eaeaea;border-radius:10px;overflow:hidden">';
      options.forEach((r,i)=>{
        const rowId='pt-row-'+id+'-'+r.type;
        const panelId='pt-panel-'+id+'-'+r.type;
        const pct=net>0?Math.round(r.costs.total/net*100):0;
        const s=FIT_STYLE[r.fit.cls]||FIT_STYLE.fo;
        h+='<div style="'+(i>0?'border-top:1px solid #f0f0f0;':'')+'">'+
          // Tappable row
          '<div id="'+rowId+'" onclick="event.stopPropagation();selectPropType(\''+id+'\',\''+r.type+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;transition:background 0.15s">'+
          '<div><div style="font-size:13px;font-weight:700;color:#2a2a2a">'+(PROP_LABELS[r.type]||r.type)+'</div>'+
          '<div style="font-size:11px;color:#999;margin-top:2px">'+fc(r.price)+' · '+fc(r.costs.total)+'/mo</div></div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
          '<div style="font-size:17px;font-weight:800;color:#222">'+pct+'%</div>'+
          '<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:'+s.bg+';color:'+s.color+'">'+r.fit.lbl+'</div>'+
          '<div id="'+rowId+'-chevron" style="font-size:13px;color:#bbb;transition:transform 0.2s">›</div>'+
          '</div>'+
          '</div>'+
          // Accordion panel — renders directly under this row
          '<div id="'+panelId+'" style="display:none;border-top:1px solid #f0f0f0"></div>'+
        '</div>';
      });
      h+='</div>';
      h+='<div style="font-size:11px;color:#aaa;margin-top:4px;text-align:right">% of monthly take-home</div>';
      return h;
    })()+
    // AI Insights sits right under the property type ladder (moved here
    // July 27 2026 per feedback — reads more naturally right after the
    // user has seen the concrete price/cost breakdown, rather than before
    // it at the top of the card).
    '<div class="ai-insights-trigger" id="ai-trigger-'+id+'" onclick="event.stopPropagation();toggleAiInsights(\''+id+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:10px 12px;margin:10px 0;background:linear-gradient(135deg,#F3EEFB,#EEF7F3);border:1px solid #E3DAF5;border-radius:10px">'+
    '<span style="font-size:13px;font-weight:700;color:#5B3A7E">✨ AI Insights for '+x.n+'</span>'+
    '<span id="ai-trigger-chevron-'+id+'" style="font-size:13px;color:#5B3A7E;transition:transform 0.2s">›</span>'+
    '</div>'+
    '<div class="ai-insights" id="ai-'+id+'" style="display:none;margin-bottom:6px"></div>'+
    '<label class="cmp-cb" onclick="event.stopPropagation()" id="cmp-lbl-'+id+'">'+
    '<input type="checkbox" id="cmp-chk-'+id+'" onchange="toggleCmpCity(\''+x.n+'\',this)">'+
    '<span class="cmp-cb-lbl">Compare this city (select up to 3 cities)</span></label>'+
    '<div class="bk">'+
    (fit.cls==='fs'?'<div style="font-size:12px;color:#633806;background:#FAEEDA;border-radius:8px;padding:8px 10px;margin-top:10px;line-height:1.6;">'+t.stretch_warn+'</div>':'')+
    '</div>'+
    '<button type="button" class="view-btn" onclick="event.stopPropagation();openListingsWindow(\''+x.n+'\',\''+activeProp+'\','+displayPrice+')">View Available '+(activeProp==='all'?'Homes':PLBL[activeProp])+' in '+x.n+'</button>'+
    '</div>';
}

function selectPropType(cityId, tp, cityName) {
  const panel   = document.getElementById('pt-panel-' + cityId + '-' + tp);
  const chevron = document.getElementById('pt-row-' + cityId + '-' + tp + '-chevron');
  if(!panel) return;

  // If same type clicked again — toggle off
  const isOpen = panel.style.display !== 'none';
  // Close all panels and reset all rows for this city first
  ['condo','town','semi','detached'].forEach(t => {
    const p = document.getElementById('pt-panel-' + cityId + '-' + t);
    const r = document.getElementById('pt-row-'   + cityId + '-' + t);
    const c = document.getElementById('pt-row-'   + cityId + '-' + t + '-chevron');
    if(p) p.style.display = 'none';
    if(r) r.style.background = '';
    if(c) c.style.transform = '';
  });
  // If it was already open — just close it (toggle off)
  if(isOpen) return;

  // Highlight selected row + rotate chevron
  const selectedRow = document.getElementById('pt-row-' + cityId + '-' + tp);
  if(selectedRow) selectedRow.style.background = '#F0FDF9';
  if(chevron) chevron.style.transform = 'rotate(90deg)';

  // Find city object
  const cityObj = window._allMarkets && window._allMarkets.find(m => m.n === cityName);
  if(!cityObj) return;

  const pt    = PT[cityName] || {};
  const price = pt[tp];
  if(!price) return;

  const c     = calcCosts(cityObj, price, fam_selected, dn_selected, tp);
  const net   = (netMonthlyIncome || grossMonthlyIncome * 0.72) || 1; // guard: never zero
  const remaining = net - c.total;
  const burdenPct = net > 0 ? Math.round(c.total / net * 100) : 0;
  // Rebate only when the buyer confirmed they qualify, and non-resident taxes
  // when they are not a citizen or PR (2026-09-23, closingcosts.js).
  const cc    = calcClosingCosts(cityName, price, buyerLttRebateApplies(), { foreignBuyer: canadianResident === false });
  const effectiveDn = Math.min(dn_selected, price); // cash-rich buyer: can't put more down than the price
  const cashToClose = effectiveDn + cc.total;
  const PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};

  // Fit label: getFit(), the one Great / Good / Stretch function
  // (REVIEW_BACKLOG.md P1-21). This panel used its own <35 / <=45 thresholds,
  // so a home at 45.3% of take-home read "Good Fit" here and "Stretch" on
  // the card above it.
  const fitObj = getFit(c.total, grossMonthlyIncome) || { cls: 'fs', lbl: T.en.fit_stretch_lbl };
  const fitLbl = fitObj.lbl, fitColor = (FIT_STYLE[fitObj.cls] || FIT_STYLE.fs).color, fitBg = (FIT_STYLE[fitObj.cls] || FIT_STYLE.fs).bg;

  const sectionHead = (title) =>
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin:14px 0 8px">' + title + '</div>';

  const sectionHeadHighlight = (title) =>
    '<div style="font-size:13px;font-weight:800;color:#1a1a1a;margin:16px 0 8px">' + title + '</div>';

  const row = (label, value, color) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f5f5f5">' +
    '<div style="font-size:12px;color:#666">' + label + '</div>' +
    '<div style="font-size:13px;font-weight:700;color:' + (color||'#1a1a1a') + '">' + value + '</div>' +
    '</div>';

  const totalRow = (label, value, color) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;margin-top:4px">' +
    '<div style="font-size:13px;font-weight:700;color:#1a1a1a">' + label + '</div>' +
    '<div style="font-size:15px;font-weight:800;color:' + (color||'#1a1a1a') + '">' + value + '</div>' +
    '</div>';

  let html = '<div style="background:#FAFAFA;border-top:2px solid #1D9E75;padding:14px 16px">';

  // Header
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
    '<div style="font-size:14px;font-weight:800;color:#1a1a1a">' + PLBL[tp] + ' — ' + fc(price) + '</div>' +
    '<div style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:' + fitBg + ';color:' + fitColor + '">' + fitLbl + '</div>' +
    '</div>';

  // SECTION 1 — Monthly Cost
  html += sectionHead('Monthly Cost Breakdown');
  html += row('Purchase Price', fc(price));
  html += row('Down Payment', '-' + fc(effectiveDn));
  html += row('Mortgage Amount (loan)', fc(Math.max(0, price - effectiveDn)), '#1a1a1a');
  html += row('Mortgage Payment', fc(c.mort) + '/mo');
  html += row('Property Tax', fc(c.tax) + '/mo');
  html += row('Insurance', fc(c.ins) + '/mo');
  html += row('Utilities', fc(c.util) + '/mo');
  html += row('Maintenance Reserve', fc(c.maint) + '/mo');
  if(tp === 'condo' && c.condoFee > 0) html += row('Condo Fees', fc(c.condoFee) + '/mo');
  html += totalRow('Total Monthly Cost', fc(c.total) + '/mo', '#1D9E75');
  html += '<div style="font-size:10px;color:#aaa;margin-top:8px;line-height:1.6">Mortgage, property tax, and insurance are calculated or sourced per city. Utilities and maintenance are general estimates and may not reflect your actual usage — verify with current bills where possible.</div>';

  // SECTION 2 — Financial Impact
  html += sectionHeadHighlight('Financial Impact');
  html += row('Net Monthly Income', fc(Math.round(net)) + '/mo');
  html += row('Housing Cost', fc(Math.round(c.total)) + '/mo', burdenPct >= 45 ? '#C05A00' : '#1a1a1a');
  html += row('Income Remaining', fc(Math.round(remaining)) + '/mo', remaining < 2000 ? '#DC2626' : '#1D9E75');
  html += totalRow('% of Income Consumed', burdenPct + '%', burdenPct >= 45 ? '#C05A00' : '#085041');

  // SECTION 3 — Closing Costs
  html += sectionHeadHighlight('Estimated Closing Costs');
  html += row('Down Payment', fc(dn_selected));
  html += row('Provincial Land Transfer Tax', fc(cc.ltt.provNet));
  if(cc.isToronto) html += row('Toronto Land Transfer Tax', fc(cc.ltt.muniNet));
  if(cc.ltt.totalRebate > 0) html += row('First-Time Buyer Rebate', '-' + fc(cc.ltt.totalRebate), '#1D9E75');
  if(cc.nrst > 0) html += row('Ontario Non-Resident Speculation Tax (25%)', fc(cc.nrst), '#C05A00');
  if(cc.mnrst > 0) html += row('Toronto Non-Resident Speculation Tax (10%)', fc(cc.mnrst), '#C05A00');
  html += row('Legal Fees', '~' + fc(cc.legal));
  html += row('Title Insurance', '~' + fc(cc.titleIns));
  html += row('Home Inspection', '~' + fc(cc.inspection));
  html += row('Moving Costs', '~' + fc(cc.moving));
  html += row('Adjustments', '~' + fc(cc.adjustments));
  html += totalRow('Estimated Cash Required to Close', '~' + fc(cashToClose), '#1a1a1a');
  if(firstTimeBuyer && canadianResident !== false && !buyerLttRebateApplies()) {
    html += '<div class="ltt-rebate-note" style="font-size:11px;color:#6B5A1E;background:#FBF6E6;border-radius:8px;padding:8px 10px;margin-top:8px;line-height:1.5">First-time buyer land transfer tax rebate not included. It applies only if neither you nor your spouse has ever owned a home anywhere in the world, and you are a Canadian citizen or permanent resident. Tick the box under the first-time buyer question if that is you.</div>';
  }


  html += '<div style="font-size:10px;color:#aaa;margin-top:10px;line-height:1.6">Estimates only — actual costs vary by transaction. New builds: HST may apply.</div>';

  // "View Available Homes" opens the dedicated listings experience for
  // this city + property type (tp) -- redesigned 2026-07-25, per explicit
  // product direction, from an inline-expand panel to a real separate
  // popup window (desktop) / navigated page (mobile). See
  // openListingsWindow() in listings-display.js.
  html += '<button type="button" class="view-btn" style="margin-top:12px" onclick="event.stopPropagation();openListingsWindow(\''+cityName+'\',\''+tp+'\','+price+')">View Available '+(PLBL[tp]||tp)+' in '+cityName+'</button>';

  html += '</div>';

  panel.innerHTML = html;
  panel.style.display = 'block';
}
