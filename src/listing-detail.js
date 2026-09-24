// listing-detail.js -- the listing detail page (listing.html?key=...).
//
// Page order is fixed and deliberate:
//   1. Top row -- HomePilot view (what this home costs THIS buyer, from
//      the buyer's own numbers -- the reason HomePilot exists) + photo
//      gallery (the card's carousel, reused, arrows always visible).
//      DOM order is HomePilot-view-then-gallery (narrow screens stack in
//      that order); on wide screens CSS `order` (listing.html) swaps them
//      visually only, so the gallery sits on the left and the cost view
//      on the right -- reading/tab order is untouched.
//   2. Property details (every stored field)
//   3. Description      (complete, untruncated)
//   [Compare -- later commit]
// then the compliance block (brokerage + PROPTX notices).
// This is the one destination for a listing: it replaced the separate
// listing-full page, so the card links here only.
//
// All of Section 1 is plain arithmetic on numbers the app already has, run
// locally in the browser by mortgage.js. NOTHING from a listing is ever sent
// to an AI system or any service other than this app's own listings API
// (PropTx IDX Data Agreement Article 6.2(k)); a test enforces that this file
// makes no such call.
//
// Depends on (loaded before it in listing.html): config.js,
// listing-page-globals.js, cities.js, mortgage.js, utils.js, i18n.js,
// explainability.js (getFit), ai.js (escapeHtml), buyer-profile.js,
// listings-display.js (fmtPrice, safeUrl, factOrOmit, moneyFactOrEstimate,
// renderIdxNotice, attachPhotoCarousel, LISTINGS_API_BASE), listing-fit.js (the cost + fit-tier
// math shared with the listing card).

// Section 1's numbers. `profile` is the validated buyer profile (or null);
// `budget` is the price the buyer was shown on the card that led here (the
// same number the listing badges compare against), or null.
// Returns null when there is nothing to compute (no valid price).
//
// The verdict badge is decided in listing-fit.js -- the 10% price ceiling
// first (past it: no badge), then the app's own getFit() for the tier -- so
// this page and the listing card always show the same badge.
function buildHomePilotView(listing, profile, budget) {
  const price = Number(listing.listPrice);
  if (!(price > 0)) return null;
  const type = listing.propertyType || null;
  const view = {
    price,
    type,
    marketKnown: ldResolveMarket(listing).known,
    taxIsReal: ldOverrides(listing).taxAnnual !== undefined,
    feeIsReal: ldOverrides(listing).condoFeeMonthly !== undefined,
    isCondo: type === "condo",
    costs: null,
    net: null,
    netIsOwn: false,       // net is the take-home the buyer typed (2026-09-24, IMPROVEMENT_PLAN.md 2.2), not the estimate
    remaining: null,
    pctOfIncome: null,     // housing cost as % of take-home income (Section 3)
    mortgageAssumptions: null, // { ratePct, amortMonths, downPayment } (Section 2)
    comfort: null,         // ldComfortPosition() result (Section 4)
    closing: null,         // ldClosingCosts() result (Section 1)
    verdict: null,      // "fg" | "fo" | "fs" (getFit's cls) or null
    verdictLabel: null, // getFit's label, from i18n
    // A 55+ / adult-lifestyle community (ldAgeRestricted, listing-fit.js):
    // labelled, not hidden, since the app does not know the buyer's age.
    ageRestricted: typeof ldAgeRestricted === "function" && ldAgeRestricted(listing),
  };
  const computed = profile ? computeListingCosts(listing, profile) : null;
  if (!computed) return view;
  view.costs = computed.costs;
  view.net = computed.net;
  view.netIsOwn = profile.takeHomeIsOwn === true && profile.netMonthlyIncome > 0;
  view.remaining = computed.net - computed.costs.total;
  view.pctOfIncome = computed.net > 0 ? (computed.costs.total / computed.net) * 100 : null;
  view.mortgageAssumptions = {
    ratePct: (profile.mortgageRate || DEFAULT_MORTGAGE_RATE_PCT / 100) * 100,
    amortMonths: ldAmortizationMonths(profile, price),
    downPayment: profile.downPayment,
  };
  view.comfort = ldComfortPosition(listing, profile);
  view.closing = ldClosingCosts(listing, profile);
  const fit = ldFitFor(listing, computed, profile, budget);
  if (fit) { view.verdict = fit.cls; view.verdictLabel = fit.lbl; }
  return view;
}

// Section 4's one-sentence budget position -- comfort range only, deliberately
// no dollar ceiling (product decision: HomePilot helps buyers understand
// sustainable choices, not maximize borrowing capacity). Text only; the
// underlying state comes entirely from ldComfortPosition() (listing-fit.js),
// which reuses calcBP()'s existing comfortBP/bp -- no new thresholds here.
function ldComfortSentence(comfort) {
  if (comfort.state === "within-comfort") return "This home is within your comfort affordability range.";
  if (comfort.state === "above-comfort-within-bank") return "This home is above your comfort affordability range, though still within what a lender would likely qualify you for.";
  return "This home is above what HomePilot's calculator estimates you would qualify for.";
}

// Section 1: a separate one-time purchase-cost block, visually distinct from
// the monthly costs above it (ld-onetime border/margin). All figures come
// from ldClosingCosts() (listing-fit.js), which wraps the existing, already-
// shipped calcClosingCosts()/calcLTT() engine (closingcosts.js) -- the same
// one render.js's own "Estimated Cash Required to Close" panel uses. The
// rebate row only appears when calcLTT() actually produced a nonzero rebate
// (which only happens for a first-time buyer), so no separate flag check is
// needed here. Moving costs and closing adjustments are included as line
// items (not just folded into the total) so the displayed total always
// equals the sum of the rows shown -- both are already part of
// calcClosingCosts()'s existing, shipped methodology.
function renderClosingCostsBlock(closing) {
  let rows = ldRow("Down payment", fmtPrice(closing.effectiveDn))
    + ldRow("Ontario land transfer tax", fmtPrice(closing.ltt.provNet));
  if (closing.isToronto) rows += ldRow("Toronto municipal land transfer tax", fmtPrice(closing.ltt.muniNet));
  if (closing.ltt.totalRebate > 0) rows += ldRow("First-time buyer land transfer tax rebate", `-${fmtPrice(closing.ltt.totalRebate)}`, "ld-credit");
  // Non-resident speculation taxes (2026-09-23, closingcosts.js).
  if (closing.nrst > 0) rows += ldRow("Ontario non-resident speculation tax (25%)", fmtPrice(closing.nrst));
  if (closing.mnrst > 0) rows += ldRow("Toronto non-resident speculation tax (10%)", fmtPrice(closing.mnrst));
  rows += ldRow("Legal fees (estimated)", fmtPrice(closing.legal))
    + ldRow("Title insurance (estimated)", fmtPrice(closing.titleIns))
    + ldRow("Home inspection (estimated)", fmtPrice(closing.inspection))
    + ldRow("Moving costs (estimated)", fmtPrice(closing.moving))
    + ldRow("Closing adjustments (estimated)", fmtPrice(closing.adjustments))
    + ldRow("Estimated cash required to purchase", fmtPrice(closing.cashRequired), "ld-total");
  return `<div class="ld-onetime"><h3>Estimated cash required to purchase</h3><div class="ld-costs">${rows}</div>`
    + `<p class="ld-muted ld-disclosure">These are estimates only and will vary by transaction -- new builds may attract HST. `
    + `Land transfer tax and rebate figures are approximate and not a substitute for a lawyer's calculation. `
    + (closing.firstTimeNoRebate ? `The first-time buyer rebate is not included: it applies only if neither you nor your spouse has ever owned a home anywhere in the world, and you are a Canadian citizen or permanent resident. ` : "")
    + (closing.foreignBuyer ? `Non-resident speculation tax is included because you said you are not a Canadian citizen or permanent resident; some buyers are exempt or can get it back, and most non-Canadians cannot buy a home until at least January 1, 2027. ` : "")
    + `This is not financial, legal, or mortgage advice -- speak with a licensed mortgage professional and a real estate lawyer before making a purchase decision.</p></div>`;
}

// Section 3: every stored field, in reading order. Plain facts use factOrOmit
// (shown when present, silently omitted otherwise -- never "N/A"); the two money
// figures use moneyFactOrEstimate (real value, else a labelled estimate).
// Heating is PropTx HeatType (the delivery system, e.g. "Forced Air"),
// labelled "Heating" -- not "Heat source", which is a different PropTx field.
//
// Size/Lot size/Building age (added 2026-09-22, migration 0005): confirmed
// via a live PropTx field investigation that the previously-assumed exact
// fields (LivingArea/BuildingAreaTotal for size, YearBuilt for age) are not
// populated -- PropTx only supplies bucketed RANGE strings for these
// ("3000-3500" / "0-5"), which is genuine data, not a fallback -- see
// ldLotSizeFact()/ldSizeFact()/ldAgeFact() below. Lot size prefers the new
// width x depth fields (100% populated on lot-bearing types, vs. the old
// lotSizeArea's 11%) and falls back to the old field only when width/depth
// are both absent; the old lotSizeArea data/column is otherwise untouched.
function ldLotSizeFact(listing) {
  if (listing.lotWidth && listing.lotDepth) {
    return `Lot size: ${escapeHtml(listing.lotWidth)} x ${escapeHtml(listing.lotDepth)} ft`;
  }
  if (listing.lotSizeArea) {
    return `Lot size: ${escapeHtml(listing.lotSizeArea)}${listing.lotSizeUnits ? " " + escapeHtml(listing.lotSizeUnits) : ""}`;
  }
  return null;
}

function ldSizeFact(listing) {
  return listing.livingAreaRange ? `Size: ${escapeHtml(listing.livingAreaRange)} sq ft` : null;
}

function ldAgeFact(listing) {
  if (!listing.approximateAge) return null;
  return listing.approximateAge === "New" ? "Building age: New" : `Building age: ${escapeHtml(listing.approximateAge)} years`;
}

// Listed date + days-ago (added 2026-09-23): reuses listings-display.js's
// own formatListedDate()/listedDaysAgoText() verbatim -- the exact same
// field (listing.listedDate), computation and "Listed" label/format already
// shown on the card (listings.html). No new field, no new $select, no new
// computation, no new label -- the days-ago piece is deliberately unlabeled
// here too, matching the card, where it's also shown with no label of its
// own. Gated on the date fact exactly like the card (listedDateAgo is only
// ever computed when listedDateFact exists).
function ldListedDateFacts(listing) {
  const dateFact = factOrOmit("Listed", formatListedDate(listing.listedDate));
  const ago = dateFact ? listedDaysAgoText(listing.listedDate) : null;
  return [dateFact, ago];
}

function fullListingFacts(listing) {
  const est = ldEstimates(listing);
  const yearSuffix = listing.taxYear ? ` (${listing.taxYear})` : "";
  const isCondo = listing.propertyType === "condo";
  const realFee = ldFeeToMonthly(listing.associationFee, listing.associationFeeFrequency);
  return [
    factOrOmit("Property type", LD_TYPE_LABELS[listing.propertyType]),
    factOrOmit("Beds", typeof ldBedsText === "function" ? ldBedsText(listing) : listing.bedrooms),
    factOrOmit("Baths", listing.bathrooms),
    ldSizeFact(listing),
    factOrOmit("Parking spaces", listing.parkingSpaces),
    factOrOmit("Total parking", listing.parkingTotal),
    factOrOmit("Garage", listing.garageType),
    factOrOmit("Basement", listing.basement),
    factOrOmit("Heating", listing.heatType),
    factOrOmit("Cooling", listing.cooling),
    factOrOmit("Year built", listing.yearBuilt),
    ldAgeFact(listing),
    ldLotSizeFact(listing),
    moneyFactOrEstimate("Property tax", listing.taxAnnualAmount, est.taxAnnual, (v) => `${fmtPrice(v)}/yr${yearSuffix}`),
    isCondo
      ? moneyFactOrEstimate("Condo fee", realFee, est.condoFee, (v) => `${fmtPrice(v)}/mo`)
      : moneyFactOrEstimate("Association fee", realFee, null, (v) => `${fmtPrice(v)}/mo`),
    factOrOmit("City", listing.city),
    factOrOmit("Postal code", listing.postalCode),
    ...ldListedDateFacts(listing),
  ].filter(Boolean);
}

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
    ? ` <span class="listing-affordability-badge listing-fit-${view.verdict}">${escapeHtml(view.verdictLabel)}</span>`
    : "";
  let html = `<h2>HomePilot view</h2><div class="ld-price">${escapeHtml(fmtPrice(view.price))}${badge}</div>`;
  if (view.ageRestricted) html += `<p class="listing-age-note">Age-restricted community (55+ or adult lifestyle) — check the age rules</p>`;
  if (!view.costs) {
    html += `<p class="ld-muted ld-noprofile">See what this home would cost you each month, and what you'd have left over: enter your income and down payment in <a href="https://myhomepilot.ca">HomePilot</a>, then open this listing again.</p>`;
    sec.innerHTML = html;
    return sec;
  }
  const c = view.costs;
  const ma = view.mortgageAssumptions;
  const amortYears = ma.amortMonths === 360 ? 30 : 25;
  const rateDisplay = ma.ratePct.toFixed(2).replace(/\.?0+$/, "");
  html += `<h3>Estimated monthly housing cost</h3><div class="ld-costs">`
    + ldRow("Mortgage", fmtPrice(c.mort))
    + ldRow(`Property tax${view.taxIsReal ? "" : " (estimated)"}`, fmtPrice(c.tax))
    + (view.isCondo ? ldRow(`Condo fee${view.feeIsReal ? "" : " (estimated)"}`, fmtPrice(c.condoFee)) : "")
    + ldRow("Insurance", fmtPrice(c.ins))
    + ldRow("Utilities", fmtPrice(c.util))
    + ldRow("Maintenance", fmtPrice(c.maint))
    + ldRow("Total per month", fmtPrice(c.total), "ld-total")
    + `</div>`
    + `<p class="ld-assumptions">Mortgage assumptions: ${rateDisplay}% rate · ${amortYears}-year amortization · ${escapeHtml(fmtPrice(ma.downPayment))} down</p>`
    // marketKnown was computed by buildHomePilotView() and then never rendered
    // (audit, 2026-09-22). When a listing's city isn't one of HomePilot's 55,
    // its property tax comes from a flat 1.05% provincial-average rate and its
    // insurance from a generic base -- but the figures above were presented
    // with exactly the same confidence as a real municipal rate. Say so.
    + (view.marketKnown ? "" : `<p class="ld-muted">HomePilot doesn't have a cost profile for this municipality yet, so the property tax and insurance figures above use Ontario-wide averages rather than local rates. Treat them as rough.</p>`)
    + `<div class="ld-income">`
    + ldRow(view.netIsOwn ? "Your take-home income" : "Estimated take-home income", `${fmtPrice(view.net)}/mo`)
    + (view.pctOfIncome !== null ? ldRow("Housing cost as % of take-home income", `${Math.round(view.pctOfIncome)}%`) : "")
    + ldRow("Remaining after this home", `${fmtPrice(view.remaining)}/mo`, "ld-remaining")
    + `</div>`
    + (view.comfort ? `<p class="ld-comfort">${ldComfortSentence(view.comfort)}</p>` : "")
    + (view.closing ? renderClosingCostsBlock(view.closing) : "");
  sec.innerHTML = html;
  return sec;
}

// Same markup and carousel code as the listing card (attachPhotoCarousel in
// listings-display.js); arrows always visible here.
function renderGallerySection(listing) {
  const photos = (Array.isArray(listing.photos) ? listing.photos : []).map(safeUrl).filter(Boolean);
  const cityEsc = escapeHtml(listing.city || "");
  const sec = document.createElement("section");
  sec.className = "ld-sec ld-gallery";
  sec.id = "ldGallery";
  sec.innerHTML = `<div class="listing-photo-wrap">
      ${photos.length
        ? `<img class="listing-photo" src="${photos[0]}" alt="Photo 1 of ${photos.length} of listing in ${cityEsc}">`
        : `<div class="listing-photo listing-photo-empty">No photo available</div>`}
      ${photos.length > 1 ? `
      <button type="button" class="listing-photo-nav listing-photo-prev" aria-label="Previous photo">‹</button>
      <button type="button" class="listing-photo-nav listing-photo-next" aria-label="Next photo">›</button>
      <span class="listing-photo-counter" aria-live="polite">1/${photos.length}</span>` : ""}
    </div>`;
  if (photos.length > 1) attachPhotoCarousel(sec, photos, cityEsc);
  return sec;
}

function renderDetailsSection(listing) {
  const sec = document.createElement("section");
  sec.className = "ld-sec ld-snap";
  sec.id = "ldDetails";
  const facts = fullListingFacts(listing);
  const tour = safeUrl(listing.virtualTourUrl);
  sec.innerHTML = `<h2>Property details</h2>` + (facts.length
    ? `<ul class="ld-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`
    : `<p class="ld-muted">No further details were provided for this listing.</p>`)
    + (tour ? `<a class="ld-tour listing-virtual-tour" href="${tour}" target="_blank" rel="noopener noreferrer">Virtual tour</a>` : "");
  return sec;
}

function renderRemarksSection(listing) {
  if (!listing.publicRemarks || !String(listing.publicRemarks).trim()) return null;
  const sec = document.createElement("section");
  sec.className = "ld-sec";
  sec.id = "ldRemarks";
  const h = document.createElement("h2");
  h.textContent = "Description";
  const p = document.createElement("div");
  p.className = "ld-remarks";
  p.textContent = String(listing.publicRemarks); // full, untruncated
  sec.appendChild(h);
  sec.appendChild(p);
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

  // Top row: DOM order stays HomePilot-view-then-gallery (unchanged --
  // narrow screens still see cost before photo, same priority as before).
  // On wide screens only, CSS `order` (see listing.html) visually swaps
  // them so the gallery sits on the left and the cost view on the right.
  const top = document.createElement("div");
  top.className = "ld-top";
  top.appendChild(renderHomePilotSection(buildHomePilotView(listing, profile, budget)));
  top.appendChild(renderGallerySection(listing));
  root.appendChild(top);

  root.appendChild(renderDetailsSection(listing));
  const remarks = renderRemarksSection(listing);
  if (remarks) root.appendChild(remarks);
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
