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

// The listings API's price floor and land rule, applied again here (added
// 2026-09-23, IMPROVEMENT_PLAN.md 1.1: "on the server and again in the
// browser"). The server is the real gate -- MIN_LISTING_PRICE and
// NOT_LAND_OR_UNIT_CLAUSE in workers/homepilot-listings/src/db.js, where the
// evidence behind both is written up. This copy exists so a stale or
// misbehaving API can never get a $1 price, a fractional resort share or a
// building lot costed and badged as a home. Keep the number equal to the
// server's.
const LD_MIN_LISTING_PRICE = 75000;

// True when this listing is something the app should cost as a home: priced at
// or above the floor, and not a zero-bedroom lot (any non-condo) or a
// zero-bedroom, zero-bathroom "condo" (parking or a commercial unit). A studio
// condo -- no bedroom, one bathroom -- is a home. A missing count is not
// evidence either way, so it passes, exactly as it does on the server.
function ldIsListableHome(listing) {
  if (!listing) return false;
  const price = Number(listing.listPrice);
  if (!(price >= LD_MIN_LISTING_PRICE)) return false;
  const count = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const beds = count(listing.bedrooms), baths = count(listing.bathrooms);
  if (beds === 0 && (baths === 0 || listing.propertyType !== "condo")) return false;
  if (ldIsLeasedTenure(listing)) return false;
  return true;
}

// Life-lease and land-lease listings (added 2026-09-23): hidden on the server
// by NOT_LEASED_TENURE_CLAUSE in the Worker's db.js, where the evidence is.
// A life lease cannot carry a mortgage ("cash only offers"); a land lease adds
// a $500-$1,000 monthly land fee this app does not cost. Same phrases, same
// denial rule ("Has Deed (Not Life Lease)" keeps the listing).
const LD_LIFE_LEASE = /life[\s-]?lease/i;
const LD_LIFE_LEASE_DENIED = /\b(?:not(?: a)?|non|no)[\s-]life[\s-]?lease/i;
const LD_LAND_LEASE = /land[\s-]lease|leased land/i;
function ldIsLeasedTenure(listing) {
  const text = String((listing && listing.publicRemarks) || "");
  return (LD_LIFE_LEASE.test(text) && !LD_LIFE_LEASE_DENIED.test(text)) || LD_LAND_LEASE.test(text);
}

// Age-restricted communities (55+, adult lifestyle) are real homes, and some
// buyers qualify, so they are labelled rather than hidden: the app doesn't
// know the buyer's age, and a family of four should not fall for one. The
// phrases were checked against production descriptions on 2026-09-23 ("55+
// gated community", "Adult Lifestyle Community", "(55+)"); a bare "seniors" is
// not used -- it mostly appears as "would suit families or seniors".
const LD_AGE_RESTRICTED = /\b(?:55|60|65)\s*(?:\+|plus)\s*(?:adult|active|gated|lifestyle|communit|building|residence|condo|living|complex|village|park|only|independent)|\((?:55|60|65)\s*\+\)|adult[\s-]lifestyle|adult[\s-](?:only|community|communities|living)|retirement (?:community|residence|living)/i;
function ldAgeRestricted(listing) {
  return LD_AGE_RESTRICTED.test(String((listing && listing.publicRemarks) || ""));
}

// Bedrooms as a buyer would say them: "1 + den" when PropTx counted a den as a
// bedroom (the API's effectiveBedrooms, EFFECTIVE_BEDROOMS_EXPR in db.js).
// null when there is no count at all -- never a guessed one.
function ldBedsText(listing) {
  if (!listing || listing.bedrooms === null || listing.bedrooms === undefined || listing.bedrooms === "") return null;
  const total = Number(listing.bedrooms), eff = Number(listing.effectiveBedrooms);
  if (Number.isFinite(eff) && Number.isFinite(total) && eff === total - 1) return eff + " + den";
  return String(listing.bedrooms);
}

// PropTx AssociationFee -> a monthly amount. A missing frequency is treated
// as monthly (Ontario condo fees are monthly, and the listing card already
// shows it that way); an unrecognised frequency returns null so the caller
// falls back to the labelled estimate instead of guessing.
// Frequencies extended 2026-09-22 (audit): only monthly/annually/quarterly/
// weekly were handled, so the other RESO AssociationFeeFrequency values fell
// through to null and silently used the city ESTIMATE instead of the real fee.
// A $700 semi-annual fee was shown as the $621 city estimate rather than $117.
const LD_FEE_DIVISORS = {
  monthly: 1, "semi-monthly": 0.5, semimonthly: 0.5,
  annually: 12, annual: 12, yearly: 12,
  "semi-annually": 6, "semi-annual": 6, semiannually: 6, "twice a year": 6,
  quarterly: 3,
  weekly: 1 / (52 / 12), "bi-weekly": 2 / (52 / 12), biweekly: 2 / (52 / 12),
};
function ldFeeToMonthly(fee, frequency) {
  const n = Number(fee);
  if (!Number.isFinite(n) || n <= 0) return null;
  const f = String(frequency || "monthly").trim().toLowerCase();
  // "One Time" is deliberately absent: a one-time charge is not a monthly cost
  // and must not be folded into one. It falls through to the estimate.
  const div = LD_FEE_DIVISORS[f];
  if (!div) return null;
  const monthly = n / div;
  // Sanity bound. A condo fee outside this range is a feed error, not a fee;
  // returning null falls back to the labelled city estimate rather than
  // rendering it as fact.
  return monthly >= 10 && monthly <= 5000 ? monthly : null;
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

// Whether this listing is in the City of Toronto, for land transfer tax.
//
// Added 2026-09-22 (audit). calcClosingCosts() decides the Toronto municipal
// LTT from an exact city-name match against its own six-card list. PropTx
// stores Toronto as district-coded values ("Toronto C07"), which
// regionForCity() normally maps to a card name -- but it returns null for a
// plain "Toronto" row or any district code TRREB adds later. In that case the
// name reaching calcClosingCosts was "Toronto C07", which matches nothing, and
// the municipal LTT was silently dropped: cash required to close came out
// $98,425 instead of $109,900 on a $750K home. An $11,475 understatement, with
// nothing on screen indicating an omission.
//
// listing-detail.js already had this exact startsWith fallback in ldBackHref(),
// so the plain-"Toronto" case was known -- the cost path just never used it.
function ldIsTorontoListing(listing) {
  const region = listing.cityRegion;
  if (typeof region === "string" && region.startsWith("Toronto")) return true;
  return typeof listing.city === "string" && /^Toronto\b/.test(listing.city.trim());
}

// The real PropTx figures, when present, that replace the engine's own
// estimates. Condo fee only ever applies to condos.
function ldOverrides(listing) {
  const o = {};
  const tax = Number(listing.taxAnnualAmount);
  // Sanity bound added 2026-09-22 (audit). Any finite positive number was
  // previously accepted verbatim, so a plausible x100 feed error --
  // taxAnnualAmount of 450000 instead of 4500 -- rendered as a property tax
  // line of $37,500/month and a total of $42,393/month, presented to the buyer
  // as this listing's real figure. Outside the bound we fall back to the
  // city-rate estimate, which the UI already labels "(estimated)".
  // $200-$200,000/yr spans a rural cabin to a high-end Toronto detached.
  if (Number.isFinite(tax) && tax >= 200 && tax <= 200000) o.taxAnnual = tax;
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
// profile, no usable price, or the listing is not a home at all (see
// ldIsListableHome) -- so neither the card nor the detail page can badge it.
function computeListingCosts(listing, profile) {
  const price = Number(listing.listPrice);
  if (!profile || !(price > 0) || !ldIsListableHome(listing)) return null;
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
  // Pass a name calcClosingCosts() recognises as Toronto even when
  // regionForCity() could not resolve the district code -- see
  // ldIsTorontoListing() for why that happens and what it used to cost.
  const cityForLtt = ldIsTorontoListing(listing) && !/^Toronto - /.test(market.n)
    ? "Toronto - Downtown"
    : market.n;
  const cc = calcClosingCosts(cityForLtt, price, profile.firstTimeBuyer === true);
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
