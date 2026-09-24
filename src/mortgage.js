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

// The most expensive home a given down payment can legally buy — the exact
// inverse of meetsMinDownPayment() below, and the same Dept. of Finance rule
// (in force Dec 15, 2024). Added 2026-09-22 after an audit found calcBP()
// reporting buying power that no down payment on record could actually close:
// a $100K income with $5K saved was shown $420,000 against a legal ceiling of
// $100,000. calcBP() applies this as a hard cap, so the headline figure is
// always a price the buyer could complete a purchase at.
//   under $500K      -> 5% of price          -> price <= dn / 0.05
//   $500K to $1.5M   -> $25K + 10% over $500K -> price <= (dn + $25K) / 0.10
//   $1.5M and above  -> 20% of price          -> price <= dn / 0.20
// Between $125K and $300K down the binding constraint is the $1.5M insured
// ceiling itself (20% is required above it), hence the Math.max.
function maxPriceForDownPayment(dn){
  if(!(dn > 0)) return 0;
  if(dn < 25000)  return dn / 0.05;
  if(dn < 125000) return (dn + 25000) / 0.10;
  return Math.max(1500000, dn / 0.20);
}

// The minimum down payment a given price requires — the same rule
// meetsMinDownPayment() checks, exposed as a number so the UI can tell a buyer
// how much MORE they need rather than only that they don't have enough.
function minDownPaymentFor(price){
  if(!(price > 0)) return 0;
  if(price < 500000)  return price * 0.05;
  if(price < 1500000) return 25000 + (price - 500000) * 0.10;
  return price * 0.20;
}

// The CMHC premium rate for a given down-payment ratio, or 0 when the loan is
// conventional (20%+ down). Single source of truth — calcBP(),
// qualifiesForProperty() and calcCosts() previously each carried their own
// copy of this ladder, and all three shared the same defect: the band was
// written `ratio < 0.20 && ratio >= 0.05`, so a ratio BELOW 5% fell through
// to no premium at all and was priced as a conventional uninsured loan — the
// cheapest kind — despite being a loan that cannot legally exist in Canada.
// That single condition produced four separate visible failures (audit,
// 2026-09-22): buying power that fell as the down payment rose, buying power
// that rose as debt rose, buying power that rose as rates rose, and a monthly
// payment that jumped $103 when a buyer crossed 5% down in the right
// direction. Sub-5% ratios now take the highest insured tier, which removes
// the discontinuity; the legality of such a price is enforced separately by
// maxPriceForDownPayment() and meetsMinDownPayment().
function cmhcPremiumRate(dpRatio, amortMonths){
  if(!(dpRatio >= 0) || dpRatio >= 0.20) return 0;
  let rate = dpRatio >= 0.15 ? 0.028 : dpRatio >= 0.10 ? 0.031 : 0.040;
  if(amortMonths > 300) rate += 0.0020; // CMHC 30yr amortization surcharge
  return rate;
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
  //
  // RESTRUCTURED 2026-09-22 (audit). The premium rate is now a PARAMETER rather
  // than something the loop derives from its own previous guess. The old version
  // re-read the CMHC tier from the prior iteration's price on every pass, so the
  // answer depended on which side of a tier boundary the iteration happened to
  // settle on — which is why buying power could RISE when debt rose or when the
  // mortgage rate rose (both nudged the converged price across the 20% line into
  // a cheaper financing regime). The loop now converges only the property-tax
  // term, which is a genuine contraction, and bestPrice() below evaluates every
  // financing regime explicitly and takes the best feasible one.
  function solveForRatios(gdsRatio, tdsRatio, amortMonths, premiumRate){
    let price = 500000; // seed
    for(let i=0;i<8;i++){
      const estTax = price*0.0105/12, heat = 150;
      const availGDS = Math.max(0, mi*gdsRatio - estTax - heat);
      const availTDS = Math.max(0, mi*tdsRatio - estTax - heat - dbt);
      const maxPayment = Math.min(availGDS, availTDS);
      if(maxPayment<=0){ price = dn; break; }
      const maxInsuredMortgage = maxPayment*(Math.pow(1+stressRate,amortMonths)-1)/(stressRate*Math.pow(1+stressRate,amortMonths));
      // Back out the CMHC premium: the payment budget supports a smaller BASE
      // loan than the raw stress-test math implies, because the premium is
      // added to the balance the payment has to cover.
      price = maxInsuredMortgage/(1+premiumRate) + dn;
    }
    return Math.max(dn, price);
  }

  // Each financing regime, with the down-payment ratio band it is valid within.
  // `lo` inclusive, `hi` exclusive — the same bands cmhcPremiumRate() applies.
  const FINANCING_REGIMES = [
    { lo:0.20, hi:Infinity, rate:0     }, // conventional / uninsured
    { lo:0.15, hi:0.20,     rate:0.028 },
    { lo:0.10, hi:0.15,     rate:0.031 },
    { lo:0.00, hi:0.10,     rate:0.040 },
  ];

  // Solves each regime independently at a FIXED premium rate, keeps only the
  // prices that actually fall inside that regime's ratio band, and returns the
  // best of them. Because each regime's solution is monotone in income, debt and
  // rate, and the maximum of monotone functions is monotone, the result no longer
  // reverses at a tier boundary the way the single-pass version did.
  //
  // 30-year amortization eligibility (verified July 11, 2026): available to (a)
  // ANY first-time buyer, regardless of down payment size — expanded Dec 15,
  // 2024 — or (b) conventional/uninsured buyers with 20%+ down (common lender
  // practice, not a federal insured-mortgage rule). New-build status also
  // qualifies buyers federally but HomePilot doesn't track new-build vs. resale,
  // so that path isn't modeled here.
  function bestPrice(gdsRatio, tdsRatio){
    let best = dn;
    for(const regime of FINANCING_REGIMES){
      const amorts = (firstTimeBuyer===true || regime.lo>=0.20) ? [300,360] : [300];
      for(const amort of amorts){
        const rate = regime.rate>0 && amort>300 ? regime.rate+0.0020 : regime.rate;
        const solved = solveForRatios(gdsRatio, tdsRatio, amort, rate);
        // A regime only applies while dn/price sits inside its band, i.e. while
        // price is in (dn/hi, dn/lo]. Cap the solved price at the top of the
        // band; discard it if it falls below the bottom (a different regime
        // covers that range, and this loop will reach it).
        const bandCeiling = regime.lo > 0 ? dn/regime.lo : Infinity;
        const bandFloor   = regime.hi < Infinity ? dn/regime.hi : 0;
        const candidate = Math.min(solved, bandCeiling);
        if(candidate > bandFloor) best = Math.max(best, candidate);
      }
    }
    return best;
  }

  // Income qualification gives a ceiling; the down payment gives a second,
  // independent one. The buyer can only actually close at the lower of the
  // two, so the headline figure is the lower of the two. Rounding is to the
  // nearest $10K as before, except that it never rounds UP through the legal
  // cap — a capped figure floors instead.
  const legalCap = maxPriceForDownPayment(dn);
  const toHeadline = (raw) => {
    const capped = Math.min(raw, legalCap);
    const rounded = Math.round(capped/10000)*10000;
    // Only the LEGAL cap floors instead of rounds. Comparing against `capped`
    // here instead would change the rounding of every uncapped figure too.
    return rounded > legalCap ? Math.floor(legalCap/10000)*10000 : rounded;
  };
  const bpRaw = bestPrice(0.39, 0.44);
  const bp = toHeadline(bpRaw);
  const comfortBPRaw = bestPrice(0.32, 0.38);
  const comfortBP = toHeadline(comfortBPRaw);
  // True when the down payment, not income, is what is holding the buyer back.
  // Lets the UI say "you qualify for more, but you need a larger down payment"
  // instead of silently showing a smaller number with no explanation.
  const downPaymentLimited = bpRaw > legalCap + 1;
  // What income alone would support, ignoring the down payment — the figure
  // this tool used to show as the headline. Paired with downPaymentShortfall
  // it turns a lower number into a savings target: "save $7,000 more and you
  // could go up to $520,000", which is a more useful answer than either the
  // old unreachable number or a bare smaller one.
  const incomeCapBP = Math.round(bpRaw/10000)*10000;
  const downPaymentShortfall = downPaymentLimited
    ? Math.max(0, Math.ceil((minDownPaymentFor(incomeCapBP) - dn)/100)*100)
    : 0;
  // The same three figures for the HomePilot comfort range (added 2026-09-24,
  // IMPROVEMENT_PLAN.md 2.2): the page leads with the comfort range, and its
  // savings tip ("Your savings are the limit... $X more saved would get you
  // there") must point at the comfort range, not at the bank's ceiling above.
  // Savings cap the comfort range only when comfort's own ratios would allow
  // more than the down payment can legally buy; then the bank's figure is
  // capped too, and both are the same figure.
  const comfortDownPaymentLimited = comfortBPRaw > legalCap + 1;
  const comfortIncomeCapBP = Math.round(comfortBPRaw/10000)*10000;
  const comfortDownPaymentShortfall = comfortDownPaymentLimited
    ? Math.max(0, Math.ceil((minDownPaymentFor(comfortIncomeCapBP) - dn)/100)*100)
    : 0;

  // Monthly payments shown to buyer use the actual selected rate (not stress rate) and
  // the amortization that was actually used to reach that ceiling.
  // The CMHC premium is now included here too (audit, 2026-09-22): it was
  // previously omitted, so this figure disagreed with calcCosts()'s mortgage
  // line by 2.8–4.2% for every buyer under 20% down — the same buyer, the same
  // price, two different monthly payments on two different screens.
  const amortFor = (price) => (firstTimeBuyer===true || (dn>0 && price>0 && dn/price>=0.20)) ? 360 : 300;
  const payment = (price, n) => {
    const ln = Math.max(0, price - dn);
    if(!(ln > 0)) return 0;
    const insured = ln * (1 + cmhcPremiumRate(price > 0 ? dn/price : 1, n));
    return Math.round(insured*(ar*Math.pow(1+ar,n))/(Math.pow(1+ar,n)-1));
  };
  const mo = payment(bp, amortFor(bp));
  const comfortMo = payment(comfortBP, amortFor(comfortBP));
  return{bp,comfortBP,mo,comfortMo,downPaymentLimited,legalCap,incomeCapBP,downPaymentShortfall,
    comfortDownPaymentLimited,comfortIncomeCapBP,comfortDownPaymentShortfall};
}

// Full per-property qualification check — used to gate whether a specific city+type
// combination actually qualifies, using real inputs instead of calcBP()'s generalized
// estimate: the CITY'S ACTUAL tax rate, 50% of the condo fee (lenders include half of
// condo fees in GDS/TDS), the dynamic stress rate, and amortization based on the real
// down-payment ratio for this specific price. This is the accurate check; calcBP() above
// is a fast general-purpose ceiling shown before a city/property is chosen.
// _hpRealOverride: reads an OPTIONAL real-figure override ({taxAnnual,
// condoFeeMonthly}) passed by the listing detail page, which knows one
// specific listing's real PropTx tax/condo fee. Returns the number if it is
// finite and positive, else null (meaning "use the usual estimate"). The
// city-level calculator and results page never pass overrides, so for them
// this is always null and nothing below changes.
function _hpRealOverride(overrides, key){
  const v = overrides ? overrides[key] : null;
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;
}

function qualifiesForProperty(inc, dn, dbt, price, propType, cityName, overrides){
  const city = M.find(c=>c.n===cityName);
  const taxRate = city ? city.tx : 0.0105;
  const mi = inc/12;
  const realTax = _hpRealOverride(overrides,'taxAnnual');
  const monthlyTax = realTax!==null ? realTax/12 : price*taxRate/12;
  const heat = 150;
  let condoFeeQual = 0;
  const realCondoFee = propType==='condo' ? _hpRealOverride(overrides,'condoFeeMonthly') : null;
  if(realCondoFee!==null){
    condoFeeQual = realCondoFee*0.5; // lenders include 50% of condo fees in GDS/TDS
  } else if(propType==='condo'){
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
  const insuredLoan = ln*(1+cmhcPremiumRate(dpRatio, amortMonths));
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

// overrides (optional, added for the listing detail page): {taxAnnual,
// condoFeeMonthly} -- one real listing's PropTx property tax and condo fee.
// When present and valid they replace the city-rate tax estimate and the
// formula condo fee (condo fee only for condos). Omitted -> exactly the
// same behavior as before, so every existing caller is unaffected.
function calcCosts(m,price,fam,dn,propType,overrides){
  // Input coercion added 2026-09-22 (audit). Three silent failures were live:
  //   - an UNDEFINED down payment gave Math.max(0, NaN) -> NaN -> a mortgage
  //     line of $0, so a $700K home reported $1,732/month with no error
  //     anywhere. An absent down payment now means ZERO down (a full mortgage),
  //     which is the conservative reading, not a paid-off house.
  //   - a NaN or Infinity price produced NaN for every line item, which then
  //     rendered as "$NaN".
  //   - a negative price produced a negative total and positive insurance.
  // Deliberately coerces rather than returning null: ~25 call sites consume
  // this, and at least one (buildCityChips in render-support.js) intentionally
  // passes `price || 0`. Coercion keeps every valid caller byte-identical while
  // removing the paths that produced NaN, negative or falsely-cheap results.
  if(!m || typeof m !== 'object') m = { n:'', tx:0.0105, ins:100, avg:0 };
  price = Number(price); if(!Number.isFinite(price) || price < 0) price = 0;
  dn = Number(dn);       if(!Number.isFinite(dn)    || dn < 0)    dn = 0;
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
  // cmhc-schl.gc.ca premium information page). See cmhcPremiumRate() at the top of
  // this file for why the sub-5% band is no longer treated as uninsured.
  const insuredLoan=ln*(1+cmhcPremiumRate(dpRatio,n));
  const mort=insuredLoan>0?Math.round(insuredLoan*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1)):0;

  // Property tax: city-level rate × price (scales correctly with price; consistent across property types in a city)
  const pt=propType||'detached';
  const realTax=_hpRealOverride(overrides,'taxAnnual');
  const taxAnnual=realTax!==null?realTax:price*m.tx;
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

  // Utilities: property-type aware. The family-size fallback stays INSIDE the
  // chosen property type (fixed 2026-09-22): it previously fell through to
  // UTIL_BY_TYPE.detached[3], so a condo with an unparseable family size was
  // billed $405/month of detached utilities instead of $200 — a cross-type
  // leak that silently overstated condo costs by ~$205/month.
  const utilTable=UTIL_BY_TYPE[pt]||UTIL_BY_TYPE.detached;
  const fk=Math.min(5,Math.max(1,parseInt(fam,10)||3));
  const util=utilTable[fk]||utilTable[3];

  // Maintenance: 1% annually, scaled by type (condos lower — building handles exterior)
  const maintFactor={condo:0.003,town:0.008,semi:0.009,detached:0.010}[pt]||0.010;
  const maint=Math.round(price*maintFactor/12);

  // Condo fee: city base fee anchored at that city's typical condo price, scaled by actual
  // price with a 0.5 dampening factor (fees correlate with unit size/price but not 1:1).
  // Example: city base $520 at typical $540K -> a $700K condo shows ~$597, a $430K one ~$467.
  let condoFee=0;
  const realCondoFee=pt==='condo'?_hpRealOverride(overrides,'condoFeeMonthly'):null;
  if(realCondoFee!==null){
    condoFee=Math.round(realCondoFee);
  } else if(pt==='condo'){
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
