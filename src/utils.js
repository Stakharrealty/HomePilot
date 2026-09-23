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

// Gross-to-net estimate for an Ontario employee.
//
// CORRECTED 2026-09-22 (audit). Three mandatory deductions were missing, and
// every one of them was missing in the direction that made housing look MORE
// affordable than it is:
//   - the Ontario surtax (20% of Ontario tax over $5,554, plus a further 36%
//     over $7,108) — this is the big one, and it applies from roughly $105K
//     of income upward;
//   - the Ontario Health Premium (up to $900/yr, a mandatory payroll levy);
//   - CPP2, the second additional CPP contribution introduced in 2024 (4% of
//     earnings between the YMPE and YAMPE, max $188).
// Measured effect of the omission: net income was overstated by $450/yr at
// $40K, $3,792 at $150K and $21,974 at $400K. Because net income is the
// denominator of getFit(), the burden percentage behind every "Great fit" /
// "Good Fit" / "Stretch" label was understated by 1–2 points at every income,
// always optimistically — enough to flip a label for any buyer sitting near
// the 35% or 45% threshold.
//
// This is an ESTIMATE, not a tax calculation: it assumes employment income
// only, the basic personal amount as the sole credit, and no RRSP room,
// dependants, or other adjustments. See DATA_FRESHNESS.incomeTaxModel in
// config.js for the vintage of these constants and when to re-verify them.
function estimateOntarioNetAnnual(grossAnnual){
  const g=Number(grossAnnual);
  if(!Number.isFinite(g)||g<=0)return 0;

  let fed=0;
  if(g<=55867)fed=g*0.15;else if(g<=111733)fed=8380+(g-55867)*0.205;else if(g<=154906)fed=19822+(g-111733)*0.26;else if(g<=246752)fed=31043+(g-154906)*0.29;else fed=57667+(g-246752)*0.33;
  fed=Math.max(0,fed-2355); // basic personal amount credit, 15% of $15,705

  let ont=0;
  if(g<=51446)ont=g*0.0505;else if(g<=102894)ont=2598+(g-51446)*0.0915;else if(g<=150000)ont=7308+(g-102894)*0.1116;else if(g<=220000)ont=12564+(g-150000)*0.1216;else ont=21076+(g-220000)*0.1316;
  ont=Math.max(0,ont-626); // Ontario basic personal amount credit, 5.05% of $12,399

  // Ontario surtax — calculated on Ontario tax AFTER credits, not on income.
  const surtax=0.20*Math.max(0,ont-5554)+0.36*Math.max(0,ont-7108);

  // Ontario Health Premium — a flat-stepped levy, not a percentage of tax.
  let ohp=0;
  if(g>20000)      ohp=Math.min(300,(g-20000)*0.06);
  if(g>36000)      ohp=Math.min(450,300+(g-36000)*0.06);
  if(g>48000)      ohp=Math.min(600,450+(g-48000)*0.25);
  if(g>72000)      ohp=Math.min(750,600+(g-72000)*0.25);
  if(g>200000)     ohp=Math.min(900,750+(g-200000)*0.25);

  const cpp=Math.min(Math.max(0,g-3500)*0.0595,3867);
  const cpp2=Math.min(Math.max(0,Math.min(g,73200)-68500)*0.04,188);
  const ei=Math.min(g*0.0166,1049);

  return Math.max(0,g-(fed+ont+surtax+ohp+cpp+cpp2+ei));
}

// Take-home pay for a household of one or two earners (added 2026-09-23,
// IMPROVEMENT_PLAN.md 3.3). Canada taxes each person separately, so two people
// earning $65K each keep about $560 a month more than one person earning
// $130K. The calculator used to tax a couple's combined income as if one
// person earned it all, which pushed every couple's "% of take-home" up.
function estimateHouseholdNetAnnual(income1, income2){
  return estimateOntarioNetAnnual(income1)+estimateOntarioNetAnnual(income2);
}
