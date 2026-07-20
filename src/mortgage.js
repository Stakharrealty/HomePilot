// mortgage.js — HomePilot affordability math
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/mortgage.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: getStressRate(), calcBP(), qualifiesForProperty(), UTIL_BY_TYPE,
// calcCosts(), meetsMinDownPayment(). These pieces were NOT contiguous in the
// original file — getFit(), PROP_LABELS, and getPriceForType()/
// getPriceForTypeStrict() were interspersed between them and are intentionally
// left in index.html for now (they belong to explainability.js and ranking.js,
// planned as later extractions).

function getStressRate(contractRate){
  return Math.max(0.0525, contractRate + 0.02);
}

function calcBP(inc,dn,dbt){
  const mi=inc/12, ar=customMortgageRate/12;
  const stressRate = getStressRate(customMortgageRate)/12;

  // Solves max price for a given GDS/TDS pair, iterating because tax+heat scale with
  // the price we're solving for, AND because CMHC premiums (for <20% down) inflate the
  // loan balance the payment has to cover — the payment budget supports a smaller BASE
  // loan than the raw stress-test math implies once the premium is backed out. Missing
  // this previously meant the headline buying-power number was mildly overstated for
  // anyone putting down under 20% (verified July 11, 2026, same audit that found the
  // CMHC 30yr surcharge gap in calcCosts/qualifiesForProperty).
  // 30-year amortization eligibility (updated July 11, 2026 — a previous audit round
  // caught this using an outdated rule): available to (a) ANY first-time buyer,
  // regardless of down payment size — expanded Dec 15, 2024 — or (b) conventional/
  // uninsured buyers with 20%+ down (common lender practice, not a federal insured-
  // mortgage rule). New-build status also qualifies buyers federally but HomePilot
  // doesn't track new-build vs. resale, so that path isn't modeled here.
  function solveForRatios(gdsRatio, tdsRatio, amortMonths){
    let price = 500000; // seed
    for(let i=0;i<8;i++){
      const estTax = price*0.0105/12, heat = 150;
      const availGDS = Math.max(0, mi*gdsRatio - estTax - heat);
      const availTDS = Math.max(0, mi*tdsRatio - estTax - heat - dbt);
      const maxPayment = Math.min(availGDS, availTDS);
      if(maxPayment<=0){ price = dn; break; }
      const maxInsuredMortgage = maxPayment*(Math.pow(1+stressRate,amortMonths)-1)/(stressRate*Math.pow(1+stressRate,amortMonths));
      // Back out the CMHC premium (using prior iteration's price as the down-payment-
      // ratio estimate — consistent with how tax already converges iteratively here).
      const dpRatioEst = price>0 ? dn/price : 1;
      let baseMortgage = maxInsuredMortgage;
      if(dpRatioEst<0.20 && dpRatioEst>=0.05){
        let cmhcRate = dpRatioEst>=0.15?0.028:dpRatioEst>=0.10?0.031:0.040;
        if(amortMonths>300) cmhcRate += 0.0020;
        baseMortgage = maxInsuredMortgage/(1+cmhcRate);
      }
      price = baseMortgage + dn;
    }
    return Math.max(dn, price);
  }

  function bestPrice(gdsRatio, tdsRatio){
    const price25 = solveForRatios(gdsRatio, tdsRatio, 300);
    const dpRatio25 = price25>0 ? dn/price25 : 1;
    const eligible30 = firstTimeBuyer===true || dpRatio25 >= 0.20;
    if(eligible30){
      const price30 = solveForRatios(gdsRatio, tdsRatio, 360);
      return Math.max(price25, price30);
    }
    return price25;
  }

  const bpRaw = bestPrice(0.39, 0.44);
  const bp = Math.round(bpRaw/10000)*10000;
  const comfortBPRaw = bestPrice(0.32, 0.38);
  const comfortBP = Math.round(comfortBPRaw/10000)*10000;

  // Monthly payments shown to buyer use the actual selected rate (not stress rate) and
  // the amortization that was actually used to reach that ceiling.
  const amortFor = (price) => (firstTimeBuyer===true || (dn>0 && price>0 && dn/price>=0.20)) ? 360 : 300;
  const nMax = amortFor(bp), nComfort = amortFor(comfortBP);
  const lnMax=Math.max(0,bp-dn);
  const mo=lnMax>0?Math.round(lnMax*(ar*Math.pow(1+ar,nMax))/(Math.pow(1+ar,nMax)-1)):0;
  const lnComfort=Math.max(0,comfortBP-dn);
  const comfortMo=lnComfort>0?Math.round(lnComfort*(ar*Math.pow(1+ar,nComfort))/(Math.pow(1+ar,nComfort)-1)):0;
  return{bp,comfortBP,mo,comfortMo};
}

// Full per-property qualification check — used to gate whether a specific city+type
// combination actually qualifies, using real inputs instead of calcBP()'s generalized
// estimate: the CITY'S ACTUAL tax rate, 50% of the condo fee (lenders include half of
// condo fees in GDS/TDS), the dynamic stress rate, and amortization based on the real
// down-payment ratio for this specific price. This is the accurate check; calcBP() above
// is a fast general-purpose ceiling shown before a city/property is chosen.
function qualifiesForProperty(inc, dn, dbt, price, propType, cityName){
  const city = M.find(c=>c.n===cityName);
  const taxRate = city ? city.tx : 0.0105;
  const mi = inc/12;
  const monthlyTax = price*taxRate/12;
  const heat = 150;
  let condoFeeQual = 0;
  if(propType==='condo'){
    const base = CONDO_FEES[cityName]||500;
    const anchor = (PT[cityName]&&PT[cityName].condo)||price;
    const ratio = anchor>0?price/anchor:1;
    const estFee = Math.round(base*(1+0.5*(ratio-1)));
    condoFeeQual = estFee*0.5; // lenders include 50% of condo fees in GDS/TDS
  }
  const dpRatio = price>0 ? dn/price : 0;
  // 30yr amortization: any first-time buyer (expanded Dec 15, 2024, regardless of down
  // payment size) OR conventional/uninsured buyers with 20%+ down. See calcBP() comment
  // for full sourcing — this was previously gated on 20%+ down only, which understated
  // buying power for first-time buyers with smaller down payments.
  const amortMonths = (firstTimeBuyer===true || dpRatio>=0.20) ? 360 : 300;
  const ln = Math.max(0, price-dn);
  let insuredLoan=ln;
  if(dpRatio<0.20 && dpRatio>=0.05){
    let cmhcRate = dpRatio>=0.15?0.028:dpRatio>=0.10?0.031:0.040;
    if(amortMonths>300) cmhcRate += 0.0020; // CMHC 30yr amortization surcharge
    insuredLoan = ln*(1+cmhcRate);
  }
  const stressRate = getStressRate(customMortgageRate)/12;
  const stressPayment = insuredLoan>0 ? insuredLoan*(stressRate*Math.pow(1+stressRate,amortMonths))/(Math.pow(1+stressRate,amortMonths)-1) : 0;
  const maxGDS = mi*0.39, maxTDS = mi*0.44;
  const gdsOk = (stressPayment+monthlyTax+heat+condoFeeQual) <= maxGDS + 1; // +1 rounding tolerance
  const tdsOk = (stressPayment+monthlyTax+heat+condoFeeQual+dbt) <= maxTDS + 1;
  return gdsOk && tdsOk;
}

// ── UTILITIES by property type and family size (monthly $) ──
// Condos: utilities often partially covered by fees — shown separately, net of typical inclusion
const UTIL_BY_TYPE={
  condo:    {1:150,2:175,3:200,4:225,5:245},
  town:     {1:225,2:265,3:315,4:365,5:415},
  semi:     {1:245,2:290,3:345,4:395,5:445},
  detached: {1:285,2:335,3:405,4:465,5:525},
};

function calcCosts(m,price,fam,dn,propType){
  const r=customMortgageRate/12,ln=Math.max(0,price-dn);
  const dpRatio=price>0?dn/price:1;
  // Amortization must match the same eligibility rule used for qualification
  // (calcBP/qualifiesForProperty), or a buyer who qualifies under 30-year amortization
  // sees an inflated 25-year monthly payment everywhere in the UI — a real gap an audit
  // caught July 11, 2026. Any first-time buyer qualifies regardless of down payment size
  // (expanded Dec 15, 2024); conventional/uninsured buyers with 20%+ down also qualify.
  const n=(firstTimeBuyer===true || dpRatio>=0.20) ? 360 : 300;
  // CMHC insurance: add to loan if down payment < 20%. +0.20% surcharge applies when
  // amortization exceeds 25 years (CMHC published rate; verified July 11, 2026, source:
  // cmhc-schl.gc.ca premium information page). This wasn't previously modeled because
  // 30-year amortization for insured first-time buyers wasn't supported until this fix.
  let insuredLoan=ln;
  if(dpRatio<0.20&&dpRatio>=0.05){
    let cmhcRate=dpRatio>=0.15?0.028:dpRatio>=0.10?0.031:0.040;
    if(n>300) cmhcRate += 0.0020;
    insuredLoan=ln*(1+cmhcRate);
  }
  const mort=insuredLoan>0?Math.round(insuredLoan*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1)):0;

  // Property tax: city-level rate × price (scales correctly with price; consistent across property types in a city)
  const pt=propType||'detached';
  const taxAnnual=price*m.tx;
  const tax=Math.round(taxAnnual/12);

  // Insurance — recalibrated July 6, 2026 against Rates.ca Home Insuramap 2026 report
  // (ON avg $2,235/yr for 2,500sqft detached; Toronto ~$1,617/yr; typical southern ON
  // detached $1,200–1,800/yr; condos $300–600/yr ≈ 0.3–0.4× detached).
  // 1.28 uplift brings city bases (set pre-2026) in line with published 2026 levels.
  // Price scaling dampened 0.5×: premiums track REBUILD cost, not market price — a home
  // 50% pricier than city average does not cost 50% more to insure.
  const insBase=(m.ins||100)*1.28;
  const insFactor={condo:0.40,town:0.75,semi:0.85,detached:1.0}[pt]||1.0;
  const priceRatio=m.avg>0?price/m.avg:1;
  const ins=Math.round(insBase*(1+0.5*(priceRatio-1))*insFactor);

  // Utilities: property-type aware
  const fk=Math.min(5,parseInt(fam));
  const util=(UTIL_BY_TYPE[pt]||UTIL_BY_TYPE.detached)[fk]||UTIL_BY_TYPE.detached[3];

  // Maintenance: 1% annually, scaled by type (condos lower — building handles exterior)
  const maintFactor={condo:0.003,town:0.008,semi:0.009,detached:0.010}[pt]||0.010;
  const maint=Math.round(price*maintFactor/12);

  // Condo fee: city base fee anchored at that city's typical condo price, scaled by actual
  // price with a 0.5 dampening factor (fees correlate with unit size/price but not 1:1).
  // Example: city base $520 at typical $540K -> a $700K condo shows ~$597, a $430K one ~$467.
  let condoFee=0;
  if(pt==='condo'){
    const baseFee=CONDO_FEES[m.n]||500;
    const anchorPrice=(PT[m.n]&&PT[m.n].condo)||price;
    const ratio=anchorPrice>0?price/anchorPrice:1;
    condoFee=Math.round(baseFee*(1+0.5*(ratio-1)));
  }

  const total=mort+tax+ins+util+maint+condoFee;
  return{mort,tax,ins,util,maint,condoFee,total};
}

function meetsMinDownPayment(price,dn){
  // Canadian minimum down payment rules (safety layer — does not affect
  // buying power, affordability, ranking, or property type logic).
  // Updated July 11, 2026 to the current federal rule: effective Dec 15, 2024, the
  // insured-mortgage price cap rose from $1M to $1.5M, and the 10% tier now extends
  // to the full $500K-$1.5M band (was $500K-$1M). 20% only required above $1.5M now.
  // Source: Dept. of Finance Canada, "Boldest Mortgage Reforms in Decades" (Sep 16 2024),
  // in effect Dec 15 2024. A previous audit round caught this tool still using the old
  // $1M threshold — this was a real, dated regulatory miss, not a stale-data issue.
  var minDown;
  if(price<500000)       minDown=price*0.05;
  else if(price<1500000) minDown=500000*0.05+(price-500000)*0.10;
  else                    minDown=price*0.20;
  return dn>=minDown;
}
