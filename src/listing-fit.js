// listing-fit.js -- one place that decides what a listing costs THIS buyer and
// which fit tier it gets, so the listing card and the listing detail page can
// never disagree.
//
// Order of decisions (product decision, Sandeep):
//   1. The 10% price ceiling comes FIRST and is unchanged: nothing above
//      budget x 1.10 is ever returned by the listings API (STRETCH_MULTIPLIER
//      in the worker's db.js) or given a badge here (LD_STRETCH_MULTIPLIER,
//      same 1.10).
//   2. For a listing inside that ceiling, the badge is the app's own getFit()
//      (explainability.js): monthly housing cost as a share of net take-home
//      -- under 35% "Great fit", 35-45% "Good Fit", 45%+ "Stretch" -- the same
//      tiers, colours and i18n labels the results page uses.
//
// Pure arithmetic, run locally in the browser. Nothing here is sent anywhere
// (PropTx IDX Data Agreement Article 6.2(k): no listing field reaches AI).
//
// Depends on: mortgage.js (calcCosts), cities.js (M), utils.js
// (estimateOntarioNetAnnual), explainability.js (getFit), i18n.js (T).
// Loaded on index.html (where main.js owns the engine globals), listings.html
// and listing.html (where listing-page-globals.js defines them).

// Same 10% stretch tolerance the listings API and results page use.
const LD_STRETCH_MULTIPLIER = 1.10;

// PropTx AssociationFee -> a monthly amount. A missing frequency is treated
// as monthly (Ontario condo fees are monthly, and the listing card already
// shows it that way); an unrecognised frequency returns null so the caller
// falls back to the labelled estimate instead of guessing.
function ldFeeToMonthly(fee, frequency) {
  const n = Number(fee);
  if (!Number.isFinite(n) || n <= 0) return null;
  const f = String(frequency || "monthly").trim().toLowerCase();
  if (f === "monthly") return n;
  if (f === "annually" || f === "annual" || f === "yearly") return n / 12;
  if (f === "quarterly") return n / 3;
  if (f === "weekly") return (n * 52) / 12;
  return null;
}

// The market record calcCosts()/qualifiesForProperty() need. Toronto rows
// resolve through cityRegion ("Toronto - North York") because the app has
// six Toronto cards and no plain "Toronto". A city the app has no record
// for gets the same defaults qualifiesForProperty() already uses for an
// unknown city, so the math still works -- its tax/insurance are estimates
// either way.
function ldResolveMarket(listing) {
  const name = listing.cityRegion || listing.city;
  const found = M.find((c) => c.n === name);
  if (found) return { market: found, known: true };
  return { market: { n: name, tx: 0.0105, ins: 100, avg: Number(listing.listPrice) || 0, min: 0, max: 0 }, known: false };
}

// The real PropTx figures, when present, that replace the engine's own
// estimates. Condo fee only ever applies to condos.
function ldOverrides(listing) {
  const o = {};
  const tax = Number(listing.taxAnnualAmount);
  if (Number.isFinite(tax) && tax > 0) o.taxAnnual = tax;
  if (listing.propertyType === "condo") {
    const fee = ldFeeToMonthly(listing.associationFee, listing.associationFeeFrequency);
    if (fee) o.condoFeeMonthly = fee;
  }
  return o;
}

// Runs fn with the engine globals (mortgage rate, first-time-buyer, net
// income) set from the buyer's profile, then puts them back EXACTLY as they
// were. On index.html those globals are the live app's state, so this must
// never leave them changed.
function ldWithEngine(profile, net, fn) {
  const saved = { rate: customMortgageRate, ftb: firstTimeBuyer, net: netMonthlyIncome };
  try {
    customMortgageRate = profile.mortgageRate || DEFAULT_MORTGAGE_RATE_PCT / 100;
    firstTimeBuyer = profile.firstTimeBuyer === true;
    netMonthlyIncome = net;
    return fn();
  } finally {
    customMortgageRate = saved.rate;
    firstTimeBuyer = saved.ftb;
    netMonthlyIncome = saved.net;
  }
}

// The buyer's net monthly income: their own reported figure, else the
// estimate-from-gross fallback. Shared by computeListingCosts() and
// ldComfortPosition() so both use exactly the same number.
function ldNetIncome(profile) {
  return profile.netMonthlyIncome > 0
    ? profile.netMonthlyIncome
    : estimateOntarioNetAnnual(profile.grossMonthlyIncome * 12) / 12;
}

// What this listing costs this buyer each month. Null when there's no
// profile or no usable price.
function computeListingCosts(listing, profile) {
  const price = Number(listing.listPrice);
  if (!profile || !(price > 0)) return null;
  const { market, known } = ldResolveMarket(listing);
  const overrides = ldOverrides(listing);
  const net = ldNetIncome(profile);
  const costs = ldWithEngine(profile, net, () =>
    calcCosts(market, price, profile.familySize, profile.downPayment, listing.propertyType || "detached", overrides));
  return {
    costs, net, overrides, marketKnown: known,
    taxIsReal: overrides.taxAnnual !== undefined,
    feeIsReal: overrides.condoFeeMonthly !== undefined,
  };
}

// Amortization eligibility, for display only (Section 2 "Mortgage
// Assumptions" transparency note). This is a READ-ONLY duplicate of the
// one-line rule already written in mortgage.js's calcCosts() (dpRatio>=0.20
// or first-time-buyer -> 360 months, else 300) -- a deliberate product
// decision to keep mortgage.js completely untouched rather than export a
// new helper from it. If that eligibility rule ever changes in mortgage.js,
// this line must be updated to match, or the transparency note will drift
// from the mortgage payment actually shown above it.
function ldAmortizationMonths(profile, price) {
  const dpRatio = price > 0 ? profile.downPayment / price : 1;
  return (profile.firstTimeBuyer === true || dpRatio >= 0.20) ? 360 : 300;
}

// Where this listing's price sits relative to the buyer's own numbers, using
// calcBP() (mortgage.js) exactly as main.js already does for the "HomePilot
// comfort range" box -- no new thresholds, no new methodology. Null when
// there's no profile or no usable price.
function ldComfortPosition(listing, profile) {
  const price = Number(listing.listPrice);
  if (!profile || !(price > 0)) return null;
  const net = ldNetIncome(profile);
  const { bp, comfortBP } = ldWithEngine(profile, net, () =>
    calcBP(profile.grossMonthlyIncome * 12, profile.downPayment, profile.existingDebt));
  let state;
  if (price <= comfortBP) state = "within-comfort";
  else if (price <= bp) state = "above-comfort-within-bank";
  else state = "above-bank";
  return { state, bp, comfortBP };
}

// One-time purchase costs for this listing: land transfer tax (provincial +
// Toronto municipal, with the first-time-buyer rebate baked in), legal fees,
// title insurance, home inspection, moving costs and closing adjustments --
// all from the existing calcClosingCosts()/calcLTT() engine (closingcosts.js),
// unchanged. effectiveDn mirrors render.js's existing cash-to-close panel: a
// cash-rich buyer can't put down more than the price. Null when there's no
// profile or no usable price.
function ldClosingCosts(listing, profile) {
  const price = Number(listing.listPrice);
  if (!profile || !(price > 0)) return null;
  const { market } = ldResolveMarket(listing);
  const cc = calcClosingCosts(market.n, price, profile.firstTimeBuyer === true);
  const effectiveDn = Math.min(profile.downPayment, price);
  return { ...cc, effectiveDn, cashRequired: effectiveDn + cc.total };
}

// The fit tier for a listing whose costs are already computed, or null when
// the listing is past the 10% ceiling (or there is no valid budget to measure
// the ceiling against). Returns { cls: "fg"|"fo"|"fs", lbl, ratio } straight
// from getFit().
function ldFitFor(listing, computed, profile, budget) {
  const price = Number(listing.listPrice);
  const b = Number(budget);
  if (!computed || !(price > 0) || !Number.isFinite(b) || b <= 0) return null;
  if (price > b * LD_STRETCH_MULTIPLIER) return null; // past the ceiling: no badge, unchanged
  // getFit() returns null when the cost or income isn't usable (2026-09-22).
  // No badge is the correct outcome there — the same as being past the ceiling.
  const fit = ldWithEngine(profile, computed.net, () => getFit(computed.costs.total, null));
  if (!fit) return null;
  return { cls: fit.cls, lbl: fit.lbl, ratio: fit.ratio };
}

// Convenience for the listing card: profile in, tier (or null) out.
function listingFit(listing, profile, budget) {
  if (!profile) return null;
  return ldFitFor(listing, computeListingCosts(listing, profile), profile, budget);
}

// Used by listing-detail.js on listing.html (moved here from it).
const LD_TYPE_LABELS = { condo: "Condo", town: "Townhouse", semi: "Semi-detached", detached: "Detached" };

// Real-or-estimated tax/condo-fee figures for Section 2, independent of the
// buyer profile (the estimates only need the market and the price).
function ldEstimates(listing) {
  const price = Number(listing.listPrice);
  if (!(price > 0)) return { taxAnnual: null, condoFee: null };
  const { market } = ldResolveMarket(listing);
  const est = calcCosts(market, price, 3, 0, listing.propertyType || "detached");
  return { taxAnnual: Math.round(price * market.tx), condoFee: listing.propertyType === "condo" ? est.condoFee : null };
}

// The buyer's total monthly housing cost for this listing, for the listing
// card: exactly computeListingCosts().costs.total (mortgage + property tax +
// insurance + utilities + maintenance + condo fee), i.e. the same calcCosts()
// number the detail page's "Total per month" shows, with real PropTx tax /
// condo fee overriding the estimates. null when there is no buyer profile or
// no usable price -- never a guessed, zero or NaN figure.
function listingMonthlyCost(listing, profile) {
  if (!profile) return null;
  const computed = computeListingCosts(listing, profile);
  const total = computed && computed.costs ? Number(computed.costs.total) : NaN;
  return Number.isFinite(total) && total > 0 ? total : null;
}
