// utils.js — HomePilot small shared helpers and static reference data
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/utils.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: fc() (currency formatter), PROP_LABELS, getPriceForType() (the
// non-strict variant — see ranking.js for getPriceForTypeStrict), and
// estimateOntarioNetAnnual() (gross-to-net income estimate).
//
// INCOM removed entirely 2026-07-22 (CITY_GEO, INCOM_PROP, buildIncomUrl()) --
// all "View Available Homes" buttons now link directly to real DDF/CREA
// listings via listings-display.js, per Sandeep's explicit decision.
//
// Note: the actual loadScenarioFromURL() CALL (as opposed to its definition,
// which lives in scenario-share.js) intentionally stays at the very end of
// index.html's own inline script — it's real init code that must run last,
// after every module has loaded, not a definition to relocate.

function fc(n){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);}

const PROP_LABELS={condo:"Condo",town:"Townhouse",semi:"Semi-Detached",detached:"Detached"};
function getPriceForType(cityName,type,bp){
  const t=PT[cityName];if(!t)return type==='all'?bp:null;
  const price=t[type];
  if(!price)return null; // null in PT means property type doesn't exist here
  if(!meetsMinDownPayment(price,dn_selected))return null; // explicit DP safety check
  // Allow up to 10% over buying power (Stretch zone), not 30%
  return price<=bp*1.10?price:null;
}

function estimateOntarioNetAnnual(grossAnnual){
  let fed=0;
  if(grossAnnual<=55867)fed=grossAnnual*0.15;else if(grossAnnual<=111733)fed=8380+(grossAnnual-55867)*0.205;else if(grossAnnual<=154906)fed=19822+(grossAnnual-111733)*0.26;else if(grossAnnual<=220000)fed=31043+(grossAnnual-154906)*0.29;else fed=49945+(grossAnnual-220000)*0.33;
  fed=Math.max(0,fed-2232);
  let ont=0;
  if(grossAnnual<=51446)ont=grossAnnual*0.0505;else if(grossAnnual<=102894)ont=2598+(grossAnnual-51446)*0.0915;else if(grossAnnual<=150000)ont=7308+(grossAnnual-102894)*0.1116;else if(grossAnnual<=220000)ont=12564+(grossAnnual-150000)*0.1216;else ont=21076+(grossAnnual-220000)*0.1316;
  ont=Math.max(0,ont-579);
  const cpp=Math.min(grossAnnual*0.0595,3867),ei=Math.min(grossAnnual*0.0166,1049);
  return Math.max(0,grossAnnual-(fed+ont+cpp+ei));
}
