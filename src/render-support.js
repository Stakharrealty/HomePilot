// render-support.js — HomePilot rendering helper functions
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/render-support.js"></script> before
// the main inline script, same shared global scope as before.
//
// Contains: buildDevPanel() (Dev Mode debug panel), buildWhyRanked(),
// PROPERTY_TIER, COMMUTE_BAND_MINUTES, getHousingOpportunityPenalty()
// (evaluates whether a higher property type is realistically available
// elsewhere for similar money/commute), getLeadSummaryForCity() (used by the
// lead payload), renderAnglePicks() (the "3 Ways to Look at Your Search"
// angle-pick cards). These support render()/go(), which remain in
// index.html's own inline script for now as the final, most tightly-coupled
// piece.

function buildDevPanel(x, compositeScore) {
  const w    = RANKING_WEIGHTS[workArrangement];
  const net  = netMonthlyIncome || grossMonthlyIncome * 0.72;
  const c    = calcCosts(x, x.dynPrice||0, fam_selected, dn_selected, x.dynPropType||'condo');
  const burden = net > 0 ? Math.round(c.total / net * 100) : 0;
  const typeCount = ['condo','town','semi','detached']
    .filter(tp => PT[x.n] && PT[x.n][tp] && PT[x.n][tp] <= buyPower).length;
  const PLBL = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};
  const propLabel = x.dynPropType ? (PLBL[x.dynPropType]||x.dynPropType) : '—';
  const aff  = Math.round(x._affordScore || 0);
  const comm = Math.round(x._commScore   || 0);
  const fin  = Math.round(compositeScore  || 0);
  const bColor = burden<35?'#1D9E75':burden<45?'#58a6ff':burden<55?'#d29922':'#f85149';
  const cColor = workArrangement==='remote'?'#555':'#58a6ff';
  const raw  = x.commuteMin!==null && x.commuteMin!==undefined ? x.commuteMin+'min' : 'n/a';

  return '<div style="margin-top:10px;padding:12px 14px;background:#0d1117;border:1.5px solid #1D9E75;border-radius:10px;font-family:monospace">'
    + '<div style="font-size:10px;font-weight:700;color:#1D9E75;letter-spacing:0.08em;margin-bottom:10px">⚙ DEV — ' + x.n + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'
      + '<div style="background:#161b22;border-radius:6px;padding:8px;text-align:center">'
        + '<div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Affordability</div>'
        + '<div style="font-size:22px;font-weight:800;color:#1D9E75">' + aff + '</div>'
        + '<div style="font-size:9px;color:#555;margin-top:2px">wt: ' + Math.round(w.affordability*100) + '%</div>'
      + '</div>'
      + '<div style="background:#161b22;border-radius:6px;padding:8px;text-align:center">'
        + '<div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Commute</div>'
        + '<div style="font-size:22px;font-weight:800;color:' + cColor + '">' + comm + '</div>'
        + '<div style="font-size:9px;color:#555;margin-top:2px">wt: ' + Math.round(w.commute*100) + '%</div>'
      + '</div>'
      + '<div style="background:#161b22;border-radius:6px;padding:8px;text-align:center">'
        + '<div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Final Score</div>'
        + '<div style="font-size:22px;font-weight:800;color:#fff">' + fin + '</div>'
        + '<div style="font-size:9px;color:#555;margin-top:2px">rank driver</div>'
      + '</div>'
    + '</div>'
    + '<div style="border-top:1px solid #21262d;padding-top:8px;font-size:11px;color:#8b949e;line-height:1.9">'
      + '<div><span style="color:#555">Property: </span><span style="color:#e6edf3">' + propLabel + '</span>'
        + '<span style="color:#555"> &nbsp;·&nbsp; Reason: </span><span style="color:#e6edf3">Highest tier within buy power</span></div>'
      + '<div><span style="color:#555">Price: </span><span style="color:#e6edf3">' + fc(x.dynPrice||0) + '</span>'
        + '<span style="color:#555"> &nbsp;·&nbsp; Monthly: </span><span style="color:#e6edf3">' + fc(c.total) + '/mo</span></div>'
      + '<div><span style="color:#555">Burden: </span><span style="color:' + bColor + '">' + burden + '%</span>'
        + '<span style="color:#555"> &nbsp;·&nbsp; Types under BP: </span><span style="color:#e6edf3">' + typeCount + '</span></div>'
      + '<div><span style="color:#555">Arrangement: </span><span style="color:#e6edf3">' + workArrangement + '</span>'
        + '<span style="color:#555"> &nbsp;·&nbsp; Commute raw: </span><span style="color:#e6edf3">' + raw + '</span></div>'
    + '</div>'
  + '</div>';
}

// buildWhyRankedBullets() now lives in src/explainability.js — loaded via <script src>.

function buildWhyRanked(x, c, net, accessTier, displayPropType, displayPrice) {
  // Renders bullets as HTML. Logic lives in buildWhyRankedBullets().
  const bullets = buildWhyRankedBullets(x, c, net, accessTier, displayPropType, displayPrice);
  if(!bullets.length) return '';
  return '<div style="margin-top:10px;padding:10px 12px;background:#F8FFFE;border:1px solid #D1FAE5;border-radius:10px">' +
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#065F46;margin-bottom:7px">Why ranked here</div>' +
    bullets.map(b =>
      '<div style="font-size:12px;color:#1a1a1a;padding:2px 0;display:flex;align-items:flex-start;gap:6px">' +
      '<span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span><span>' + b.text + '</span></div>'
    ).join('') +
    '</div>';
}

// computeCityScore now lives in src/ranking.js — loaded via <script src>.

// ─── HOUSING OPPORTUNITY COMPONENT ──────────────────────────────────────────
// Evaluates whether the buyer's HomePilot Comfort Budget could realistically
// buy a HIGHER property type somewhere else with a similar commute profile.
// This is relative, not income-tier-based: it asks "is there a better deal
// for the same money and same commute window?" — not "should this income
// bracket prefer detached homes." If no better alternative exists nearby,
// no penalty applies, regardless of what type the buyer is currently shown.

const PROPERTY_TIER = { condo: 1, town: 2, semi: 3, detached: 4 };
const COMMUTE_BAND_MINUTES = 15; // "similar commute" = within this many minutes

function getHousingOpportunityPenalty(cityName, currentPropType, currentCommuteMin, comfortBudget, allCandidateCities) {
  // No penalty if buyer has explicitly filtered to a specific property type —
  // they've told us their preference, we shouldn't second-guess it.
  if (activeProp !== 'all') return 0;
  if (!currentPropType || !PROPERTY_TIER[currentPropType]) return 0;
  if (!comfortBudget || comfortBudget <= 0) return 0;

  const currentTier = PROPERTY_TIER[currentPropType];
  if (currentTier === PROPERTY_TIER.detached) return 0; // already at the top, nothing to compare against

  let bestAlternativeTier = currentTier;

  for (const otherCity of allCandidateCities) {
    if (otherCity.n === cityName) continue;
    const otherPT = PT[otherCity.n];
    if (!otherPT) continue;

    // Commute comparability: only compare cities within a similar commute band.
    // If commute isn't relevant (remote work) or unresolvable, skip the commute
    // gate and compare on affordability alone.
    if (workArrangement !== 'remote') {
      const otherCommute = calcCommuteMinutes(otherCity.n);
      if (currentCommuteMin === null || otherCommute === null) continue; // can't compare fairly
      if (Math.abs(otherCommute - currentCommuteMin) > COMMUTE_BAND_MINUTES) continue;
    }

    // Find the highest property tier available in the other city at or under comfort budget
    for (const type of ['detached', 'semi', 'town', 'condo']) {
      const price = otherPT[type];
      if (price && price <= comfortBudget) {
        const tier = PROPERTY_TIER[type];
        if (tier > bestAlternativeTier) bestAlternativeTier = tier;
        break; // highest available tier in this city found, move to next city
      }
    }
  }

  const tierGap = bestAlternativeTier - currentTier;
  if (tierGap <= 0) return 0;

  // Modest, proportional penalty — should nudge, not override affordability/commute.
  // 1 tier gap (e.g. condo vs town) = small nudge. 2+ tier gap = slightly more.
  if (tierGap === 1) return 5;
  if (tierGap === 2) return 8;
  return 10; // 3 tier gap, e.g. condo vs detached
}

function getLeadSummaryForCity(cityName){
  // Mirrors the same qualification logic used in render()'s default view, so the lead
  // payload reflects exactly what the buyer actually saw on screen for this city —
  // not a re-derived or approximate figure.
  const city=M.find(c=>c.n===cityName);
  const pt=PT[cityName];
  if(!city||!pt) return null;
  const TIERS=['detached','semi','town','condo'];
  const fullyQualifies=t=>pt[t]&&meetsMinDownPayment(pt[t],dn_selected)&&qualifiesForProperty(grossMonthlyIncome*12,dn_selected,existingDebt,pt[t],t,cityName);
  const affordableTiers=TIERS.filter(fullyQualifies);
  let type=null;
  if(affordableTiers.length){
    type=affordableTiers[0];
  } else {
    type=[...TIERS].reverse().find(t=>pt[t]&&pt[t]<=buyPower&&fullyQualifies(t));
  }
  if(!type) return null;
  const price=pt[type];
  const c=calcCosts(city,price,fam_selected,dn_selected,type);
  return {city:cityName,type,price,monthlyCost:c.total};
}

function renderAnglePicks(tpEl, withPrice) {
  var t     = T[lang] || T['en'];
  var picks = getAnglePicks(withPrice);
  var net   = netMonthlyIncome || grossMonthlyIncome * 0.72;
  var PLBL  = {detached:'Detached',semi:'Semi-Detached',town:'Townhouse',condo:'Condo'};

  if(!picks) {
    var stretchPicks=[];
    var STIERS=['condo','town','semi','detached'];
    for(var ci=0;ci<withPrice.length;ci++){
      var city=withPrice[ci];
      for(var ti=0;ti<STIERS.length;ti++){
        var stp=STIERS[ti];
        var sp=getPriceForTypeStrict(city.n,stp,buyPower);
        if(!sp) continue;
        var sc=calcCosts(city,sp,fam_selected,dn_selected,stp);
        var sburden=net>0?sc.total/net:1;
        if(sburden>=0.45&&sburden<0.55){
          stretchPicks.push({city:city,tp:stp,price:sp,monthly:sc.total,burden:Math.round(sburden*100)});
          break;
        }
      }
      if(stretchPicks.length>=3) break;
    }
    if(stretchPicks.length>0){
      tpEl.innerHTML=
        '<div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:14px;padding:16px 18px;margin-bottom:16px">'+
        '<div style="font-size:13px;font-weight:700;color:#92400E;margin-bottom:4px">⚠️ Outside Your Comfort Range</div>'+
        '<div style="font-size:12px;color:#78350F;margin-bottom:12px">No cities fit comfortably within your budget right now. These are the closest ownership opportunities — monthly costs will be tight.</div>'+
        stretchPicks.map(function(sp2){
          var dt=workArrangement!=='remote'?getAccessTier(sp2.city.commuteMin):null;
          var dr=dt?dt.label:'';
          return '<div style="background:#fff;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'+
            '<div><div style="font-size:13px;font-weight:700;color:#1a1a1a">'+sp2.city.n+'</div>'+
            '<div style="font-size:11px;color:#666;margin-top:2px">'+PLBL[sp2.tp]+' · '+fc(sp2.price)+' · '+fc(sp2.monthly)+'/mo'+(dr?' · '+dr:'')+'</div></div>'+
            '<div style="text-align:right"><div style="font-size:16px;font-weight:800;color:#D97706">'+sp2.burden+'%</div>'+
            '<div style="font-size:10px;color:#999;font-weight:600">of take-home</div></div></div>';
        }).join('')+'</div>';
    } else { tpEl.innerHTML=''; }
    return;
  }

  window._anglePicks = picks;

  var angles = [
    { label:'⭐ Best Overall',          pick: picks.overall, useLowest: false },
    { label:'🏡 Most House',            pick: picks.house,   useLowest: false },
    { label:'🗽 Most Financial Freedom', pick: picks.value,  useLowest: true  },
  ].filter(function(a){ return a.pick !== null; });

  var cardsHTML = angles.map(function(a) {
    var e    = a.pick;
    var id   = 'tp-'+e.city.n.replace(/[^a-zA-Z0-9]/g,'-')+'-'+a.label.replace(/[^a-zA-Z]/g,'');
    // Most Financial Freedom shows the cheapest type (most cash left over)
    var dispType  = a.useLowest ? (e.lowestType  || e.bestType)  : e.bestType;
    var dispPrice = a.useLowest ? (e.lowestPrice || e.bestPrice) : e.bestPrice;
    var c         = a.useLowest ? (e.lowestCost  || e.bestCost)  : e.bestCost;
    var fit = getFit(c.total, grossMonthlyIncome);
    var tier = workArrangement !== 'remote' ? getAccessTier(e.cm) : null;
    var drive = tier ? tier.label : '';
    var pct = net>0 ? Math.round((c.total/net)*100) : 0;
    var scoreColor = fit.cls==='fg'?'#085041':fit.cls==='fo'?'#0C447C':'#633806';
    var scoreBg    = fit.cls==='fg'?'#E1F5EE':fit.cls==='fo'?'#E6F1FB':'#FAEEDA';

    return '<div class="city tp" id="'+id+'" onclick="toggle(\''+id+'\')">'+
      '<div class="ct">'+
        '<div>'+
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#1D9E75;margin-bottom:3px">'+a.label+'</div>'+
          '<div class="cn">'+e.city.n+'</div>'+
          '<div class="cd">'+PLBL[dispType]+' · '+fc(dispPrice)+' · '+fc(c.total)+'/mo'+(drive?' · '+drive:'')+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<span class="cmp-fit '+fit.cls+'" style="font-size:11px;padding:3px 8px;border-radius:20px;font-weight:600;display:inline-block">'+fit.lbl+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="bk">'+
        '<div class="brow"><div class="blbl"><span class="bico">🏷</span>'+t.price_lbl+'</div><div class="bval">'+fc(dispPrice)+'</div></div>'+
        '<div class="brow"><div class="blbl"><span class="bico">⌂</span>'+t.mortgage+'</div><div class="bval">'+fc(c.mort)+'/mo</div></div>'+
        '<div class="brow"><div class="blbl"><span class="bico">%</span>'+t.prop_tax+'</div><div class="bval">'+fc(c.tax)+'/mo</div></div>'+
        '<div class="brow"><div class="blbl"><span class="bico">🛡</span>'+t.insurance+'</div><div class="bval">'+fc(c.ins)+'/mo</div></div>'+
        '<div class="brow"><div class="blbl"><span class="bico">⚡</span>'+t.utilities+'</div><div class="bval">'+fc(c.util)+'/mo</div></div>'+
        '<div class="brow"><div class="blbl"><span class="bico">🔧</span>'+t.maintenance+'</div><div class="bval">'+fc(c.maint)+'/mo</div></div>'+
        (c.condoFee>0?'<div class="brow"><div class="blbl"><span class="bico">🏢</span>Condo Fees</div><div class="bval">'+fc(c.condoFee)+'/mo</div></div>':'')+
        '<div class="brow"><div class="btlbl">'+t.total+'</div><div class="btval">'+fc(c.total)+'/mo</div></div>'+
        '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:'+scoreBg+';display:flex;align-items:center;justify-content:space-between">'+
          '<div><div style="font-size:22px;font-weight:800;color:'+scoreColor+'">'+pct+'%</div>'+
          '<div style="font-size:11px;font-weight:600;color:'+scoreColor+';opacity:0.85;margin-top:1px">of take-home pay</div>'+
          '<div style="font-size:11px;color:'+scoreColor+';opacity:0.75;margin-top:3px">'+fit.msg+'</div></div>'+
        '</div>'+
        '<a href="'+buildIncomUrl(e.city.n,buyPower,dispType)+'" target="_blank" class="view-btn">🏠 View '+PLBL[dispType]+' homes in '+e.city.n+'</a>'+
      '</div>'+
    '</div>';
  }).join('');

  tpEl.innerHTML =
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#bbb;margin-bottom:10px">3 Ways to Look at Your Search</div>'+
    cardsHTML+
    '<div class="tp-divider">All Cities</div>';
}
