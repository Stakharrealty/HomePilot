// homepilot-score.js — HomePilot's internal "buyer tier" scoring/sort system
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/homepilot-score.js"></script> before
// the main inline script, same shared global scope as before.
//
// Contains: DESIRABILITY (per-city desirability rating), getBuyerTier(),
// TIER_WEIGHTS, getScoringDriveMinutes(), getHomePilotScore(),
// getCityScoreReasons(), homePilotSort(). This system is separate from the
// primary computeCityScore()/getAnglePicks() ranking in ranking.js —
// homePilotSort() is called from go() to set the final display order of
// results, and getHomePilotScore()/getCityScoreReasons() feed the Dev Mode
// panel (buildDevPanel(), not yet extracted). NOT dead code — actively used.

const DESIRABILITY={"Toronto - Downtown":10,"Toronto - West End":9.5,"Toronto - East End":9,"Toronto - North York":9,"Toronto - Etobicoke":8.5,"Toronto - Scarborough":8,"Mississauga":8.5,"Oakville":9.5,"Burlington":9,"Richmond Hill":9,"Vaughan":8.5,"Markham":8.5,"Brampton":7.5,"Milton":8.5,"Georgetown":8,"Halton Hills":7.5,"Ajax":7.5,"Pickering":7.5,"Whitby":7.5,"Aurora":8.5,"King City":8.5,"Bolton":7.5,"Newmarket":8,"Bradford":7,"Innisfil":6.5,"Barrie":7,"Caledon":7.5,"Orangeville":7,"Mono":6.5,"Erin":6.5,"Grand Valley":6,"Shelburne":6.5,"Guelph":7.5,"Cambridge":7,"Kitchener":7,"Waterloo":7.5,"Hamilton":7,"Oshawa":6.5,"Clarington":6.5,"Scugog":6,"Georgina":6,"Centre Wellington":6.5,"Acton":6.5,"Collingwood":7,"Wasaga Beach":6.5,"Midland":6,"St. Catharines":6.5,"Niagara Falls":6.5,"Welland":5.5,"Fort Erie":5,"Cobourg":6,"Belleville":6,"Kingston":7,"Peterborough":6.5,"Ottawa":7.5};

function getBuyerTier(a){return a>=300000?3:a>=150000?2:1;}
const TIER_WEIGHTS={1:{affordability:0.70,commute:0.20,desirability:0.10},2:{affordability:0.50,commute:0.30,desirability:0.20},3:{affordability:0.25,commute:0.40,desirability:0.35}};

// Resolves the commute minutes used for scoring purposes only.
// When the buyer has specified a real work arrangement + location, this uses
// the actual work-zone-aware commute (Brampton sub-zones, rush-hour multiplier,
// etc. via calcCommuteMinutes). Falls back to the legacy Toronto-anchor table
// ONLY for remote workers or when no work zone could be resolved, since in
// those cases there is no real commute to measure against.
function getScoringDriveMinutes(cityName){
  if(workArrangement!=='remote' && workZone){
    const real=calcCommuteMinutes(cityName);
    if(real!==null) return real;
  }
  return DRIVE_TO_TORONTO[cityName]||120;
}

function getHomePilotScore(cityData,annualIncome,buyingPower){
  const tier=getBuyerTier(annualIncome),weights=TIER_WEIGHTS[tier];
  const drive=getScoringDriveMinutes(cityData.n),desirability=DESIRABILITY[cityData.n]||6;
  const fitCls=cityData.ft?.cls||cityData.dynFit?.cls||'fo';
  const affordScore=fitCls==='fg'?10:fitCls==='fo'?7:4;
  const commuteScore=Math.max(1,10-(drive/15));
  const raw=(affordScore*weights.affordability)+(commuteScore*weights.commute)+(desirability*weights.desirability);
  return Math.round(Math.min(10,Math.max(1,raw))*10)/10;
}

function getCityScoreReasons(cityData,annualIncome,buyingPower,hpScore){
  const tier=getBuyerTier(annualIncome),drive=getScoringDriveMinutes(cityData.n);
  const fitCls=cityData.ft?.cls||cityData.dynFit?.cls||'fo',des=DESIRABILITY[cityData.n]||6;
  const isRealCommute=workArrangement!=='remote' && !!workZone;
  const commuteLabel=isRealCommute?"to work":"to Toronto core";
  const reasons=[];
  if(fitCls==='fg')reasons.push("Fits your budget comfortably");
  else if(fitCls==='fo')reasons.push("Good value for your budget");
  else reasons.push("Stretch — pushing your budget limit");
  if(drive<=15)reasons.push("Minutes "+commuteLabel+" ("+drive+" min)");
  else if(drive<=30)reasons.push("Short commute "+commuteLabel+" ("+drive+" min)");
  else if(drive<=50)reasons.push("Easy commute "+commuteLabel+" ("+drive+" min)");
  else if(drive<=75)reasons.push("Manageable drive "+commuteLabel+" ("+drive+" min)");
  else reasons.push("Long commute "+commuteLabel+" ("+drive+" min)");
  if(des>=9)reasons.push("Highly desirable neighbourhood");
  else if(des>=8)reasons.push("Strong lifestyle and amenities");
  else if(des>=7)reasons.push("Solid community with good amenities");
  else reasons.push("Emerging market with growth potential");
  return reasons.slice(0,3);
}

function homePilotSort(cityA,cityB,annualIncome,buyingPower){
  const tierOrder={fg:0,fo:1,fs:2};
  const aTier=tierOrder[cityA.ft?.cls]??3,bTier=tierOrder[cityB.ft?.cls]??3;
  if(aTier!==bTier)return aTier-bTier;
  const aScore=cityA.hpScore||getHomePilotScore(cityA,annualIncome,buyingPower);
  const bScore=cityB.hpScore||getHomePilotScore(cityB,annualIncome,buyingPower);
  return bScore-aScore;
}
