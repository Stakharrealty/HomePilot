// compare.js — HomePilot city comparison tool
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/compare.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: cmpSelected (up to 3 ticked cards, by card id) and cmpTicked
// (the home each showed), initCompare() (go() calls it on every new search:
// the ticks belong to the cards of the search they were made on),
// shownCardFor() / cmpCardFor(), toggleCmpCity(), buildCompare() (renders the
// side-by-side comparison table).

let cmpSelected=[], cmpTicked={};
// The compare bar (#cmpSticky, fixed at the bottom) and the WhatsApp button
// share the bottom-right corner. While the bar is up, body.cmp-bar-open moves
// the WhatsApp button above it (CSS in calculator.html), so it no longer
// covers the bar's Compare button (IMPROVEMENT_PLAN.md 2.10).
function setCmpBarOpen(open){if(document.body)document.body.classList.toggle('cmp-bar-open',!!open);}
function initCompare(){cmpSelected=[];cmpTicked={};const table=document.getElementById('cmpTable'),btn=document.getElementById('cmpBtn');if(table)table.innerHTML='';if(btn)btn.style.display='none';const sticky=document.getElementById('cmpSticky');if(sticky)sticky.style.display='none';setCmpBarOpen(false);}
// A place can have two cards since 2026-09-24 (the three answers can show the
// same place with different homes, IMPROVEMENT_PLAN.md 2.2), so a tick is
// kept as the ticked card's id, with the card's line in shownCards as it was
// when ticked (cmpTicked): buildCompare() compares the home that card showed,
// even once "See all places" is closed or re-sorted and the card is gone. A
// plain place name still works: its first card on the page.
function shownCardFor(sel){
  const cards=Array.isArray(shownCards)?shownCards:[];
  return cards.find(c=>c.cardId===sel)||cards.find(c=>c.city===sel)||null;
}
function cmpCardFor(sel){ return cmpTicked[sel]||shownCardFor(sel); }
function toggleCmpCity(cityName,checkbox){
  const cityEl=(checkbox&&checkbox.closest&&checkbox.closest('.city'))||document.getElementById('c-'+cityName.replace(/[^a-zA-Z0-9]/g,'-'));
  const key=cityEl&&cityEl.id?cityEl.id:cityName;
  if(checkbox.checked){
    if(!cmpSelected.includes(key)){if(cmpSelected.length>=3){checkbox.checked=false;return;}cmpSelected.push(key);}
    const card=shownCardFor(key);if(card)cmpTicked[key]=card;
    if(cityEl)cityEl.classList.add('cmp-on');
  }
  else{cmpSelected=cmpSelected.filter(c=>c!==key);delete cmpTicked[key];if(cityEl)cityEl.classList.remove('cmp-on');}
  const btn=document.getElementById('cmpBtn');btn.style.display=cmpSelected.length>=2?'block':'none';
  const sticky=document.getElementById('cmpSticky'),stickyLabel=document.getElementById('cmpStickyLabel');
  if(sticky){sticky.style.display=cmpSelected.length>=2?'flex':'none';setCmpBarOpen(cmpSelected.length>=2);if(stickyLabel)stickyLabel.textContent=cmpSelected.length+' cit'+(cmpSelected.length===1?'y':'ies')+' selected';}
  if(document.getElementById('cmpTable').innerHTML&&cmpSelected.length>=2)buildCompare();
}
function buildCompare(){
  if(cmpSelected.length<2)return;
  // Now uses getPriceForTypeStrict (full qualification: real city tax rate, 50% condo
  // fee, dynamic stress test) instead of the looser getPriceForType. Also no longer
  // hard-defaults to 'detached' when the "All types" filter is active — that silently
  // broke the comparison for any city without detached inventory under budget (returned
  // null, fell back to a stale homePrice). Now picks each city's best qualifying tier,
  // same approach the main results view uses.
  const TIERS=['detached','semi','town','condo'];
  const data=cmpSelected.map(sel=>{
    // The home the card showed (shownCards, 2026-09-23), so the comparison
    // compares what the buyer ticked -- not the most expensive type the bank
    // would allow, which is what this picked before.
    const card=cmpCardFor(sel);
    const cityName=card?card.city:sel;
    const r=results.find(x=>x.n===cityName);
    let type=activeProp, price=null;
    if(card){
      type=card.type;price=card.price;
    } else if(activeProp==='all'){
      for(const tp of TIERS){ const p=getPriceForTypeStrict(cityName,tp,buyPower); if(p){type=tp;price=p;break;} }
    } else {
      price=getPriceForTypeStrict(cityName,activeProp,buyPower);
    }
    if(!price){price=r.homePrice;type=type==='all'?'detached':type;}
    const c=calcCosts(r,price,fam_selected,dn_selected,type);
    // getFit() returns null when there is nothing usable to rate (2026-09-22).
    // The compare table needs a row per selected city, so an unratable city
    // shows a dash rather than being silently dropped from the comparison.
    const fit=getFit(c.total,grossMonthlyIncome);
    // Same rounded estimate the card shows (commuteEstimateMin, ranking.js).
    const drive=workArrangement!=='remote'?commuteEstimateMin(cityName):(DRIVE_TO_TORONTO[cityName]||null);
    return{name:cityName,price,total:c.total,
      fitCls:fit?fit.cls:'',fitLbl:fit?fit.lbl:'—',fitScore:fit?fit.score:null,drive};
  });
  const minTotal=Math.min(...data.map(d=>d.total)),maxTotal=Math.max(...data.map(d=>d.total));
  const minPrice=Math.min(...data.map(d=>d.price)),maxPrice=Math.max(...data.map(d=>d.price));
  const minDrive=Math.min(...data.map(d=>d.drive||999)),maxDrive=Math.max(...data.map(d=>d.drive||0));
  const rankCls=(val,min,max)=>val===min?'best':val===max?'worst':data.length>2?'mid':'';
  const gridTpl='130px '+data.map(()=>'1fr').join(' ');
  const headCells='<div class="cmp-head-cell" style="text-align:left;color:#999">Area</div>'+data.map(d=>'<div class="cmp-head-cell">'+d.name+'</div>').join('');
  const driveLabel = workArrangement!=='remote' ? '🚗 Est. Commute<br>to Work' : '🚗 Drive to<br>Toronto';
  const rows=[{label:'Home Price',cells:data.map(d=>({val:fc(d.price),cls:rankCls(d.price,minPrice,maxPrice)}))},{label:'💰 Monthly Cost',cells:data.map(d=>({val:fc(d.total)+'/mo',cls:rankCls(d.total,minTotal,maxTotal)}))},{label:'📊 Comfort Score',cells:data.map(d=>({val:'<span class="cmp-fit '+d.fitCls+'">'+d.fitLbl+'</span><div style="font-size:11px;color:#999;margin-top:3px">'+d.fitScore+' / 100</div>',cls:''}))},{label:driveLabel,cells:data.map(d=>({val:d.drive?d.drive+' min':'—',cls:rankCls(d.drive,minDrive,maxDrive)}))}];
  const rowsHtml=rows.map(row=>'<div class="cmp-row" style="grid-template-columns:'+gridTpl+'"><div class="cmp-cell" style="justify-content:flex-start;color:#555;font-size:12px;font-weight:600">'+row.label+'</div>'+row.cells.map(c=>'<div class="cmp-cell '+c.cls+'">'+c.val+'</div>').join('')+'</div>').join('');
  const tableHtml='<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:24px;max-width:600px;margin:0 auto"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px"><span style="font-size:18px;font-weight:700;color:#1a1a1a">Area Comparison</span><button onclick="window.close()" style="font-size:13px;padding:6px 14px;border-radius:8px;border:1px solid #e0e0e0;background:#fff;cursor:pointer;color:#666">✕ Close</button></div><div style="font-size:13px;color:#888;margin-bottom:16px">Comparing '+data.length+' areas · Based on your budget of '+fc(buyPower)+'</div><div class="cmp-table"><div class="cmp-head" style="grid-template-columns:'+gridTpl+'">'+headCells+'</div>'+rowsHtml+'</div><div style="font-size:11px;color:#bbb;margin-top:12px;text-align:center">🟢 Best &nbsp;·&nbsp; 🟡 Middle &nbsp;·&nbsp; 🔴 Highest &nbsp;·&nbsp; Drive times are highway estimates</div></div>';
  const w=window.open('','_blank','width=640,height=520,scrollbars=yes,resizable=yes');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compare Areas — HomePilot</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f5f5f5;color:#1a1a1a;padding:0}.cmp-table{width:100%;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8;background:#fff}.cmp-head{display:grid;background:#f7f7f7;border-bottom:1px solid #e8e8e8}.cmp-head-cell{font-size:12px;font-weight:700;color:#1a1a1a;padding:12px;text-align:center}.cmp-row{display:grid;border-bottom:1px solid #f5f5f5}.cmp-row:last-child{border-bottom:none}.cmp-cell{font-size:13px;color:#1a1a1a;padding:12px;text-align:center;display:flex;align-items:center;justify-content:center;flex-direction:column}.cmp-fit{display:inline-block;font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600}.fg{background:#E1F5EE;color:#085041}.fo{background:#E6F1FB;color:#0C447C}.fs{background:#FAEEDA;color:#633806}.best{color:#1D9E75;font-weight:700}.mid{color:#b8860b;font-weight:600}.worst{color:#c0392b;font-weight:600}</style></head><body>'+tableHtml+'</body></html>');
  w.document.close();
}
