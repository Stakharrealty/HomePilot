// render.js — HomePilot card rendering
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules) — the final, most tightly-coupled piece of
// the split. Pure relocation — no logic changed, no values changed. Loaded
// via <script src="src/render.js"></script> before the main inline script,
// same shared global scope as before.
//
// Contains: render() (builds the city cards from `results`, the largest
// single function in the app) and selectPropType() (per-property-type panel
// expansion). Both read/write shared global state (results, activeProp,
// activeFit, buyPower, workArrangement, etc.) declared in index.html's
// remaining inline script (main.js territory) — this is safe because these
// are function declarations, not executed until called, by which point every
// script has fully loaded in both a real browser and this project's test
// harness (same reasoning already verified for _scnWA in scenario-sandbox.js).

function render(){
  let d=results;
  if(activeFit==='stretch'){
    const extraCities=[],existingNames=new Set(d.map(x=>x.n));
    window._allMarkets&&window._allMarkets.forEach(m=>{if(existingNames.has(m.n))return;const types=PT[m.n]||{};const hasStretch=Object.values(types).some(v=>v&&v>buyPower&&v<=buyPower*1.10);if(hasStretch)extraCities.push(m);});
    d=[...d,...extraCities];
  }
  if(activeProp!=='all'){d=d.filter(x=>{const p=getPriceForTypeStrict(x.n,activeProp,buyPower);return p!==null;});}
  const withPrice=d.map(x=>{
    let displayPrice,displayPropType,isStretchOnly=false,unlockType=null;
    if(activeProp!=='all'){displayPrice=getPriceForType(x.n,activeProp,buyPower)||x.homePrice||buyPower;displayPropType=activeProp;}
    else{
      // Recommended outcome = highest tier (detached > semi > town > condo)
      // that fits inside HomePilot Comfort Range (GDS 32%), not the full
      // stretch-inclusive buying power. This is the single headline number
      // shown on the primary card.
      //
      // EXCEPTION for non-remote buyers: "highest affordable tier" can hide a
      // much better choice. A buyer working in Brampton sees Brampton's semi
      // ($840K, fits comfort) as the headline and never sees Brampton's own
      // condo ($540K) — even though the condo is cheaper AND has the same
      // 13-min commute. Worse, that hidden condo might also be the thing that
      // would have made this city's headline a Great Fit instead of Good Fit.
      // So for non-remote buyers, pick whichever comfort-affordable tier
      // produces the best compositeScore (affordability + commute combined),
      // rather than mechanically always reaching for the highest tier.
      const pt=PT[x.n]||{};
      const TIERS=['detached','semi','town','condo'];
      // fitsComfort/stretch checks now run the same full qualification used elsewhere
      // (real city tax rate, 50% condo fee in TDS, dynamic stress test) — previously
      // this default "all types" view only checked price against the blended comfort/
      // bank ceiling, meaning a condo could show here as a fit while failing the exact
      // same qualification if the buyer then filtered specifically to "Condo".
      const fullyQualifies=t=>pt[t]&&meetsMinDownPayment(pt[t],dn_selected)&&qualifiesForProperty(grossMonthlyIncome*12,dn_selected,existingDebt,pt[t],t,x.n);
      const fitsComfort=t=>pt[t]&&pt[t]<=comfortBuyPower&&fullyQualifies(t);
      const existsAtAll=t=>pt[t]!=null;
      const affordableTiers=TIERS.filter(fitsComfort);
      if(affordableTiers.length){
        if(workArrangement!=='remote'){
          const commuteMinForPick=calcCommuteMinutes(x.n);
          let bestTier=affordableTiers[0],bestScore=-Infinity;
          affordableTiers.forEach(tp=>{
            const s=computeCityScore(x,grossMonthlyIncome,netMonthlyIncome,pt[tp],commuteMinForPick,tp).finalScore;
            if(s>bestScore){bestScore=s;bestTier=tp;}
          });
          displayPropType=bestTier;
        } else {
          displayPropType=affordableTiers[0]; // highest tier first, original behavior
        }
        displayPrice=pt[displayPropType];
        // Check whether a higher tier would unlock at full Bank Qualification
        // (buyPower) but not at Comfort Range — used for the quiet secondary note.
        const idx=TIERS.indexOf(displayPropType);
        for(let i=0;i<idx;i++){if(pt[TIERS[i]]&&pt[TIERS[i]]<=buyPower&&fullyQualifies(TIERS[i])){unlockType=TIERS[i];break;}}
      } else {
        // Only show if cheapest type is within bank max (buyPower) AND
        // satisfies the minimum down payment AND full qualification (condo fee/tax-aware).
        const stretchTier=[...TIERS].reverse().find(t=>pt[t]&&pt[t]<=buyPower&&fullyQualifies(t));
        if(!stretchTier) return null;
        displayPropType=stretchTier;
        displayPrice=pt[displayPropType];
        isStretchOnly=true;
      }
    }
    const c=calcCosts(x,displayPrice,fam_selected,dn_selected,displayPropType);
    const fit=getFit(c.total,grossMonthlyIncome);
    const commuteMin=workArrangement!=='remote'?calcCommuteMinutes(x.n):null;
    const scoreObj=computeCityScore(x,grossMonthlyIncome,netMonthlyIncome,displayPrice,commuteMin,displayPropType);
    let compositeScore=scoreObj.finalScore;
    const _affordScore=scoreObj.affordScore;
    const _commScore=scoreObj.commScore;
    const hoPenalty=getHousingOpportunityPenalty(x.n,displayPropType,commuteMin,comfortBuyPower,d);
    compositeScore-=hoPenalty;
    return{...x,dynFit:fit,dynPrice:displayPrice,dynPropType:displayPropType,isStretchOnly,unlockType,homePrice:x.homePrice||buyPower,displayMax:x.displayMax||Math.min(x.max,buyPower*1.10),commuteMin,compositeScore,hoPenalty,_affordScore,_commScore};
  }).filter(Boolean).sort((a,b)=>b.compositeScore-a.compositeScore);
  const t=T[lang];
  let d2=withPrice;
  // Fit filters are INCLUSIVE of better tiers, not strict buckets. A buyer
  // clicking "Good Fit" wants to see good options — a city that's actually
  // BETTER (Great Fit) should never be hidden just because it cleared a
  // higher bar than the one they clicked. This was the real cause of
  // Brampton (condo, Great Fit, cheapest + best commute) disappearing from
  // the Good Fit view while objectively worse options (Bolton, Caledon
  // townhouses) stayed visible. Great Fit itself stays strict since nothing
  // ranks above it; Stretch is effectively "show everything" since it's the
  // bottom tier.
  if(activeFit==='great')d2=withPrice.filter(x=>x.dynFit.cls==='fg');
  else if(activeFit==='good')d2=withPrice.filter(x=>x.dynFit.cls==='fo');
  else if(activeFit==='stretch')d2=withPrice.filter(x=>x.dynFit.cls==='fs');

  const tpEl=document.getElementById('topPicks');
  if(tpEl){
    // Always pass the full unfiltered market list so angle picks
    // can find the best city for each angle regardless of active fit filter
    const allMarketsForAngles = (window._allMarkets && window._allMarkets.length) ? window._allMarkets : withPrice;
    renderAnglePicks(tpEl, allMarketsForAngles);
  }

    const el=document.getElementById('list');
  const rateBarEl = document.getElementById('rateBar');
  if(!d2.length){
    const pn={all:'any property',condo:'a condo',town:'a townhouse',semi:'a semi-detached',detached:'a detached home'}[activeProp];
    el.innerHTML='<div style="font-size:13px;color:#999;padding:16px 0;text-align:center;">'+t.no_results+' '+pn+' '+t.no_results2+'<br><span style="font-size:12px;">'+t.no_results3+'</span></div>';
    if(rateBarEl) rateBarEl.style.display='none';
    const _sb=document.getElementById('shareBar');
    if(_sb) _sb.style.display='none';
    return;
  }
  // Show rate bar and sync its inputs to current rate
  const shareBarEl = document.getElementById('shareBar');
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
  const PLABELS={condo:t.filter_condo,town:t.filter_town,semi:t.filter_semi,detached:t.filter_det};
  el.innerHTML=d2.map((x)=>{
    const id='c-'+x.n.replace(/[^a-zA-Z0-9]/g,'-');
    let displayPrice,propLabel,priceRange,unlockNote='';
    if(activeProp==='all'){
      // Single recommended outcome per city, already resolved upstream against
      // Comfort Range (see withPrice mapping). No multi-type button row here —
      // one number is the headline. activeProp lets a buyer explicitly override
      // and explore other types if they want to.
      displayPrice=x.dynPrice;
      priceRange=fc(displayPrice);
      propLabel=PROP_LABELS[x.dynPropType]+' — '+fc(displayPrice);
      if(x.isStretchOnly){
        unlockNote='<div style="font-size:12px;color:#996600;margin-top:6px;display:flex;align-items:center;gap:5px"><span>⚠</span>Even '+(PROP_LABELS[x.dynPropType]||'this').toLowerCase()+' stretches your comfort range here</div>';
      } else if(x.unlockType){
        unlockNote='';
      }
    } else {
      displayPrice=getPriceForTypeStrict(x.n,activeProp,buyPower);priceRange=fc(displayPrice);propLabel=PROP_LABELS[activeProp]+' — '+fc(displayPrice);
    }
    const c=calcCosts(x,displayPrice,fam_selected,dn_selected,activeProp!=='all'?activeProp:(x.dynPropType||'detached')),fit=getFit(c.total,grossMonthlyIncome);
    const scoreColor=fit.cls==='fg'?'#085041':fit.cls==='fo'?'#0C447C':'#633806';
    const scoreBg=fit.cls==='fg'?'#E1F5EE':fit.cls==='fo'?'#E6F1FB':'#FAEEDA';
    // For commuters, lead with what actually matters to them: the commute reality.
    // The static lifestyle blurb (e.g. "trendy", "condos from $X") is irrelevant
    // noise to someone evaluating cities by drive time to their job.
    const accessTier=(workArrangement!=='remote')?getAccessTier(x.commuteMin):null;
    const cardDesc=(workArrangement!=='remote'&&accessTier)
      ?('🚗 '+accessTier.label+' to your work location'+(accessTier.label==='Limited Commute'?' — long daily drive':''))
      :x.d;
    return '<div class="city" id="'+id+'" onclick="toggle(\''+id+'\')">'+
      '<div class="ct"><div><div class="cn">'+x.n+'</div>'+(accessTier?'<div class="commute-badge '+accessTier.cls+'">🚗 '+accessTier.label+'</div>':'')+'</div>'+
      '<div style="text-align:right">'+
      (function(){
        // Show monthly cost RANGE when viewing all types; single number when filtered
        if(activeProp === 'all') {
          const _pt = PT[x.n] || {};
          const _TIERS = ['condo','town','semi','detached'];
          const _net = netMonthlyIncome || grossMonthlyIncome * 0.72;
          const _qualifying = _TIERS.filter(tp => _pt[tp] && _pt[tp] <= buyPower && meetsMinDownPayment(_pt[tp], dn_selected));
          if(_qualifying.length >= 2) {
            const _loC  = calcCosts(x, _pt[_qualifying[0]],                          fam_selected, dn_selected, _qualifying[0]);
            const _hiC  = calcCosts(x, _pt[_qualifying[_qualifying.length - 1]],     fam_selected, dn_selected, _qualifying[_qualifying.length - 1]);
            return '<div style="font-size:10px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">Monthly range</div>'+
              '<div style="font-size:14px;font-weight:800;color:#1D9E75;white-space:nowrap" id="'+id+'-mtotal">'+fc(_loC.total)+' – '+fc(_hiC.total)+'/mo</div>'+
              '<div style="font-size:10px;color:#bbb;margin-top:2px">'+(_qualifying.length)+' types available</div>';
          }
        }
        // Single type (filtered or only one qualifying)
        return '<div style="font-size:10px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">'+t.true_cost+'</div>'+
          '<div style="font-size:17px;font-weight:800;color:#1D9E75;white-space:nowrap" id="'+id+'-mtotal">'+fc(c.total)+'/mo</div>'+
          '<div style="font-size:11px;color:#bbb;margin-top:2px" id="'+id+'-mmort">'+t.mortgage+': '+fc(c.mort)+'/mo</div>';
      })()+
      '</div></div>'+
      '<div class="ai-insights-trigger" id="ai-trigger-'+id+'" onclick="event.stopPropagation();toggleAiInsights(\''+id+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:10px 12px;margin:10px 0;background:linear-gradient(135deg,#F3EEFB,#EEF7F3);border:1px solid #E3DAF5;border-radius:10px">'+
      '<span style="font-size:13px;font-weight:700;color:#5B3A7E">✨ AI Insights for '+x.n+'</span>'+
      '<span id="ai-trigger-chevron-'+id+'" style="font-size:13px;color:#5B3A7E;transition:transform 0.2s">›</span>'+
      '</div>'+
      '<div class="ai-insights" id="ai-'+id+'" style="display:none;margin-bottom:6px"></div>'+
      unlockNote+
      buildWhyRanked(x, c, netMonthlyIncome||grossMonthlyIncome*0.72, accessTier, x.dynPropType||activeProp, displayPrice)+
      (devMode?buildDevPanel(x,compositeScore):'')+
      (function(){
        // PROPERTY LADDER — shows every property type for this city that the
        // bank can qualify (price <= buyPower), each with its monthly cost,
        // burden % of net take-home, and a fit label per type.
        const net=netMonthlyIncome||grossMonthlyIncome*0.72;
        const pt=PT[x.n]||{};
        const order=['condo','town','semi','detached'];
        const rows=order.filter(tp=>pt[tp]&&pt[tp]<=buyPower&&meetsMinDownPayment(pt[tp],dn_selected)&&(activeProp==='all'||activeProp===tp)).map(tp=>{
          const price=pt[tp];
          const cc=calcCosts(x,price,fam_selected,dn_selected,tp);
          const pct=net>0?Math.round(cc.total/net*100):0;
          // Fit label per type based on burden thresholds
          let fitLbl,fitColor,fitBg;
          if(pct<35){fitLbl='Great Fit';fitColor='#085041';fitBg='#E1F5EE';}
          else if(pct<=45){fitLbl='Good Fit';fitColor='#0C447C';fitBg='#E6F1FB';}
          else{fitLbl='Stretch';fitColor='#633806';fitBg='#FAEEDA';}
          return {tp,price,mo:cc.total,pct,fitLbl,fitColor,fitBg};
        });
        if(!rows.length) return '';
        // Instruction above ladder
        let h='<div style="font-size:11px;color:#999;margin-top:10px;margin-bottom:6px;text-align:center;letter-spacing:0.01em">Tap a property type to see full cost breakdown</div>';
        h+='<div style="border:1px solid #eaeaea;border-radius:10px;overflow:hidden">';
        rows.forEach((r,i)=>{
          const rowId='pt-row-'+id+'-'+r.tp;
          const panelId='pt-panel-'+id+'-'+r.tp;
          h+='<div style="'+(i>0?'border-top:1px solid #f0f0f0;':'')+'">'+
            // Tappable row
            '<div id="'+rowId+'" onclick="event.stopPropagation();selectPropType(\''+id+'\',\''+r.tp+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;transition:background 0.15s">'+
            '<div><div style="font-size:13px;font-weight:700;color:#2a2a2a">'+(PROP_LABELS[r.tp]||r.tp)+'</div>'+
            '<div style="font-size:11px;color:#999;margin-top:2px">'+fc(r.price)+' · '+fc(r.mo)+'/mo</div></div>'+
            '<div style="display:flex;align-items:center;gap:8px">'+
            '<div style="font-size:17px;font-weight:800;color:#222">'+r.pct+'%</div>'+
            '<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:'+r.fitBg+';color:'+r.fitColor+'">'+r.fitLbl+'</div>'+
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
      '<div class="cm" style="margin-top:8px"><div></div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+
      ''+
      '</div></div>'+
      (function(){
        // Great Fit is a pure affordability label — it says nothing about commute.
        // When a city scores well on budget but lands in Limited Commute for
        // commute, say so explicitly next to the badge, so the green pill is
        // never mistaken for "this is your best overall option."
        if(workArrangement==='remote'||!accessTier) return '';
        if(accessTier.label!=='Limited Commute') return '';
        const fitPhrase=fit.cls==='fg'?'Great Fit on budget':fit.cls==='fo'?'Good Fit on budget':'A stretch on budget';
        return '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#FFF4E5;border:1px solid #FFE0B2;font-size:12px;color:#8A5A00;display:flex;align-items:flex-start;gap:6px"><span>⚠</span><span>'+fitPhrase+' — but Limited Commute to work is a long daily drive. Worth weighing against cities with better commute.</span></div>';
      })()+
      '<label class="cmp-cb" onclick="event.stopPropagation()" id="cmp-lbl-'+id+'">'+
      '<input type="checkbox" id="cmp-chk-'+id+'" onchange="toggleCmpCity(\''+x.n+'\',this)">'+
      '<span class="cmp-cb-lbl">Compare this city (select up to 3 cities)</span></label>'+
      '<div class="bk">'+
      (fit.cls==='fs'?'<div style="font-size:12px;color:#633806;background:#FAEEDA;border-radius:8px;padding:8px 10px;margin-top:10px;line-height:1.6;">'+t.stretch_warn+'</div>':'')+
      '</div>'+
      '<a href="'+buildIncomUrl(x.n,buyPower,activeProp!=='all'?activeProp:(()=>{const pt=PT[x.n]||{};return pt.detached&&pt.detached<=buyPower?'detached':pt.semi&&pt.semi<=buyPower?'semi':pt.town&&pt.town<=buyPower?'town':'condo';})())+'" target="_blank" onclick="event.stopPropagation()" class="view-btn">🏠 View Available Homes in '+x.n+'</a>'+
      '</div></div>';
  }).join('');
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
  const cc    = calcClosingCosts(cityName, price, firstTimeBuyer);
  const effectiveDn = Math.min(dn_selected, price); // cash-rich buyer: can't put more down than the price
  const cashToClose = effectiveDn + cc.total;
  const PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};

  // Fit label
  let fitLbl, fitColor, fitBg;
  if(burdenPct < 35)      { fitLbl='Great Fit'; fitColor='#085041'; fitBg='#E1F5EE'; }
  else if(burdenPct <= 45){ fitLbl='Good Fit';  fitColor='#0C447C'; fitBg='#E6F1FB'; }
  else                    { fitLbl='Stretch';   fitColor='#633806'; fitBg='#FAEEDA'; }

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
  if(firstTimeBuyer && cc.ltt.totalRebate > 0) html += row('First-Time Buyer Rebate', '-' + fc(cc.ltt.totalRebate), '#1D9E75');
  html += row('Legal Fees', '~' + fc(cc.legal));
  html += row('Title Insurance', '~' + fc(cc.titleIns));
  html += row('Home Inspection', '~' + fc(cc.inspection));
  html += row('Moving Costs', '~' + fc(cc.moving));
  html += row('Adjustments', '~' + fc(cc.adjustments));
  html += totalRow('Estimated Cash Required to Close', '~' + fc(cashToClose), '#1a1a1a');


  html += '<div style="font-size:10px;color:#aaa;margin-top:10px;line-height:1.6">Estimates only — actual costs vary by transaction. New builds: HST may apply.</div>';

  // Per-type "View Available Homes" — unlike the city-level button, this one never
  // has to guess which property type to link to (that was the deferred INCOM bug —
  // see July 15 audit notes). We already know exactly which type this panel is for.
  html += '<a href="'+buildIncomUrl(cityName,price,tp)+'" target="_blank" onclick="event.stopPropagation()" class="view-btn" style="margin-top:12px">🏠 View Available '+(PLBL[tp]||tp)+' in '+cityName+'</a>';

  html += '</div>';

  panel.innerHTML = html;
  panel.style.display = 'block';
}
