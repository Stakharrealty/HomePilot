// listing-detail.js -- the listing detail page (listing.html?key=...).
//
// Page order is fixed and deliberate:
//   1. HomePilot view   (what this home costs THIS buyer, from the buyer's own
//                        numbers -- the reason HomePilot exists)
//   2. Property snapshot (the important facts, scannable)
//   [3. Compare, 4. Full listing -- later commits]
// then the compliance block (brokerage + PROPTX notices).
//
// All of Section 1 is plain arithmetic on numbers the app already has, run
// locally in the browser by mortgage.js. NOTHING from a listing is ever sent
// to an AI system or any service other than this app's own listings API
// (PropTx IDX Data Agreement Article 6.2(k)); a test enforces that this file
// makes no such call.
//
// Depends on (loaded before it in listing.html): config.js, cities.js,
// mortgage.js, utils.js, ai.js (escapeHtml), buyer-profile.js,
// listings-display.js (fmtPrice, safeUrl, factOrOmit, moneyFactOrEstimate,
// renderIdxNotice, LISTINGS_API_BASE).

// mortgage.js reads these two as globals (in the main app they live in
// main.js). This page has no calculator, so it owns them and sets them from
// the buyer's saved profile before running the engine.
let customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT / 100;
let firstTimeBuyer = false;

// Same 10% stretch tolerance the listings API and results page use (see
// STRETCH_MULTIPLIER in the worker's db.js).
const LD_STRETCH_MULTIPLIER = 1.10;

const LD_TYPE_LABELS = { condo: "Condo", town: "Townhouse", semi: "Semi-detached", detached: "Detached" };

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
// unknown city, so the page still works -- its tax/insurance are estimates
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

// Section 1's numbers. `profile` is the validated buyer profile (or null);
// `budget` is the price the buyer was shown on the card that led here (the
// same number the listing badges compare against), or null.
// Returns null when there is nothing to compute (no valid price).
function buildHomePilotView(listing, profile, budget) {
  const price = Number(listing.listPrice);
  if (!(price > 0)) return null;
  const type = listing.propertyType || null;
  const { market, known } = ldResolveMarket(listing);
  const overrides = ldOverrides(listing);
  const view = {
    price,
    type,
    marketKnown: known,
    taxIsReal: overrides.taxAnnual !== undefined,
    feeIsReal: overrides.condoFeeMonthly !== undefined,
    isCondo: type === "condo",
    costs: null,
    net: null,
    remaining: null,
    verdict: null,
  };
  if (!profile) return view;

  customMortgageRate = profile.mortgageRate || DEFAULT_MORTGAGE_RATE_PCT / 100;
  firstTimeBuyer = profile.firstTimeBuyer === true;
  view.costs = calcCosts(market, price, profile.familySize, profile.downPayment, type || "detached", overrides);
  const net = profile.netMonthlyIncome > 0
    ? profile.netMonthlyIncome
    : estimateOntarioNetAnnual(profile.grossMonthlyIncome * 12) / 12;
  view.net = net;
  view.remaining = net - view.costs.total;

  // Verdict uses the SAME rule and the SAME badge copy as the listing card:
  // at or under the budget the buyer was shown = Within Budget; above it but
  // inside the 10% stretch range = Stretch Option. Anything past the stretch
  // range gets no badge (the remaining-income line still tells the truth).
  const b = Number(budget);
  if (Number.isFinite(b) && b > 0) {
    if (price <= b) view.verdict = "within";
    else if (price <= b * LD_STRETCH_MULTIPLIER) view.verdict = "stretch";
  }
  return view;
}

// Real-or-estimated tax/condo-fee figures for Section 2, independent of the
// buyer profile (the estimates only need the market and the price).
function ldEstimates(listing) {
  const price = Number(listing.listPrice);
  if (!(price > 0)) return { taxAnnual: null, condoFee: null };
  const { market } = ldResolveMarket(listing);
  const est = calcCosts(market, price, 3, 0, listing.propertyType || "detached");
  return { taxAnnual: Math.round(price * market.tx), condoFee: listing.propertyType === "condo" ? est.condoFee : null };
}

// Section 2, in the agreed priority order. Plain facts use factOrOmit (shown
// when present, silently omitted otherwise -- never "N/A"); the two money
// figures use moneyFactOrEstimate (real value, else a labelled estimate).
// Square footage and "utilities included" are not stored yet, and heating is
// PropTx HeatType (the delivery system, e.g. "Forced Air"), labelled
// "Heating" -- not "Heat source", which is a different PropTx field (fuel).
function snapshotFacts(listing) {
  const est = ldEstimates(listing);
  const yearSuffix = listing.taxYear ? ` (${listing.taxYear})` : "";
  const parking = listing.parkingSpaces != null && listing.parkingSpaces !== "" ? listing.parkingSpaces : listing.parkingTotal;
  const realFee = ldFeeToMonthly(listing.associationFee, listing.associationFeeFrequency);
  return [
    factOrOmit("Beds", listing.bedrooms),
    factOrOmit("Baths", listing.bathrooms),
    factOrOmit("Property type", LD_TYPE_LABELS[listing.propertyType]),
    factOrOmit("Parking", parking),
    factOrOmit("Basement", listing.basement),
    factOrOmit("Year built", listing.yearBuilt),
    listing.propertyType === "condo"
      ? moneyFactOrEstimate("Condo fee", realFee, est.condoFee, (v) => `${fmtPrice(v)}/mo`)
      : null,
    moneyFactOrEstimate("Property tax", listing.taxAnnualAmount, est.taxAnnual, (v) => `${fmtPrice(v)}/yr${yearSuffix}`),
    factOrOmit("Heating", listing.heatType),
  ].filter(Boolean);
}

const LD_VERDICT = {
  within: { cls: "listing-badge-within", label: "✅ Within Budget" },
  stretch: { cls: "listing-badge-stretch", label: "⚠️ Stretch Option" },
};

function ldRow(label, amount, cls) {
  return `<div class="ld-row${cls ? " " + cls : ""}"><span>${label}</span><span>${amount}</span></div>`;
}

function renderHomePilotSection(view) {
  const sec = document.createElement("section");
  sec.className = "ld-sec ld-hp";
  sec.id = "ldHomePilot";
  if (!view) {
    sec.innerHTML = `<h2>HomePilot view</h2><p class="ld-muted">This listing has no price on file, so HomePilot can't work out a monthly cost.</p>`;
    return sec;
  }
  const badge = view.verdict
    ? ` <span class="listing-affordability-badge ${LD_VERDICT[view.verdict].cls}">${LD_VERDICT[view.verdict].label}</span>`
    : "";
  let html = `<h2>HomePilot view</h2><div class="ld-price">${escapeHtml(fmtPrice(view.price))}${badge}</div>`;
  if (!view.costs) {
    html += `<p class="ld-muted ld-noprofile">See what this home would cost you each month, and what you'd have left over: enter your income and down payment in <a href="https://myhomepilot.ca">HomePilot</a>, then open this listing again.</p>`;
    sec.innerHTML = html;
    return sec;
  }
  const c = view.costs;
  html += `<h3>Estimated monthly housing cost</h3><div class="ld-costs">`
    + ldRow("Mortgage", fmtPrice(c.mort))
    + ldRow(`Property tax${view.taxIsReal ? "" : " (estimated)"}`, fmtPrice(c.tax))
    + (view.isCondo ? ldRow(`Condo fee${view.feeIsReal ? "" : " (estimated)"}`, fmtPrice(c.condoFee)) : "")
    + ldRow("Insurance", fmtPrice(c.ins))
    + ldRow("Utilities", fmtPrice(c.util))
    + ldRow("Maintenance", fmtPrice(c.maint))
    + ldRow("Total per month", fmtPrice(c.total), "ld-total")
    + `</div><div class="ld-income">`
    + ldRow("Estimated take-home income", `${fmtPrice(view.net)}/mo`)
    + ldRow("Remaining after this home", `${fmtPrice(view.remaining)}/mo`, "ld-remaining")
    + `</div>`;
  sec.innerHTML = html;
  return sec;
}

function renderSnapshotSection(listing) {
  const sec = document.createElement("section");
  sec.className = "ld-sec ld-snap";
  sec.id = "ldSnapshot";
  const facts = snapshotFacts(listing);
  sec.innerHTML = `<h2>Property snapshot</h2>` + (facts.length
    ? `<ul class="ld-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`
    : `<p class="ld-muted">No further details were provided for this listing.</p>`);
  return sec;
}

// Compliance block: brokerage (Article 6.3(c), same size/weight as the other
// details, not visually separated) and the two PROPTX notices, exactly as on
// the listing card/page.
function renderComplianceBlock(listing) {
  const wrap = document.createElement("div");
  wrap.className = "ld-compliance";
  const brokerage = document.createElement("div");
  brokerage.className = "listing-brokerage";
  brokerage.textContent = `Listed by ${listing.brokerageName || "Brokerage not available"}`;
  wrap.appendChild(brokerage);
  wrap.appendChild(renderIdxNotice());
  return wrap;
}

function ldBackHref(listing) {
  const city = listing.cityRegion || (String(listing.city || "").startsWith("Toronto") ? "Toronto" : listing.city);
  return city ? `listings.html?city=${encodeURIComponent(city)}` : "listings.html";
}

function renderListingDetail(root, listing, profile, budget) {
  root.textContent = "";
  const head = document.createElement("div");
  head.className = "ld-head";
  const title = listing.displayAddress ? escapeHtml(listing.displayAddress) : escapeHtml(listing.city || "Listing");
  head.innerHTML = `<h1>${title}</h1>` + (listing.displayAddress && listing.city ? `<div class="ld-sub">${escapeHtml(listing.city)}</div>` : "");
  root.appendChild(head);
  root.appendChild(renderHomePilotSection(buildHomePilotView(listing, profile, budget)));
  root.appendChild(renderSnapshotSection(listing));
  root.appendChild(renderComplianceBlock(listing));
  const back = document.getElementById("ldBack");
  if (back) back.setAttribute("href", ldBackHref(listing));
}

async function ldInit() {
  const root = document.getElementById("ldRoot");
  if (!root) return;
  const params = new URLSearchParams(window.location.search);
  const key = params.get("key");
  const message = (text) => { root.innerHTML = `<div class="listings-error">${escapeHtml(text)}</div>`; };
  if (!key) { message("No listing specified. Please go back and try again."); return; }
  root.innerHTML = `<div class="listings-loading">Loading listing…</div>`;
  let listing = null;
  try {
    const resp = await fetch(`${LISTINGS_API_BASE}/listing?key=${encodeURIComponent(key)}`);
    if (resp.status === 404) { message("This listing is no longer available."); return; }
    if (!resp.ok) throw new Error(`Listing API returned ${resp.status}`);
    listing = (await resp.json()).listing;
  } catch (e) {
    message("Couldn't load this listing right now. Please try again shortly.");
    return;
  }
  const rawBudget = Number(params.get("budget"));
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : null;
  renderListingDetail(root, listing, loadBuyerProfile(), budget);
}

ldInit();
