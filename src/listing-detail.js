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
    remaining: null,
    pctOfIncome: null,     // housing cost as % of take-home income (Section 3)
    mortgageAssumptions: null, // { ratePct, amortMonths, downPayment } (Section 2)
    comfort: null,         // ldComfortPosition() result (Section 4)
    closing: null,         // ldClosingCosts() result (Section 1)
    verdict: null,      // "fg" | "fo" | "fs" (getFit's cls) or null
    verdictLabel: null, // getFit's label, from i18n
  };
  const computed = profile ? computeListingCosts(listing, profile) : null;
  if (!computed) return view;
  view.costs = computed.costs;
  view.net = computed.net;
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
  rows += ldRow("Legal fees (estimated)", fmtPrice(closing.legal))
    + ldRow("Title insurance (estimated)", fmtPrice(closing.titleIns))
    + ldRow("Home inspection (estimated)", fmtPrice(closing.inspection))
    + ldRow("Moving costs (estimated)", fmtPrice(closing.moving))
    + ldRow("Closing adjustments (estimated)", fmtPrice(closing.adjustments))
    + ldRow("Estimated cash required to purchase", fmtPrice(closing.cashRequired), "ld-total");
  return `<div class="ld-onetime"><h3>Estimated cash required to purchase</h3><div class="ld-costs">${rows}</div>`
    + `<p class="ld-muted ld-disclosure">These are estimates only and will vary by transaction -- new builds may attract HST. `
    + `Land transfer tax and rebate figures are approximate and not a substitute for a lawyer's calculation. `
    + `This is not financial, legal, or mortgage advice -- speak with a licensed mortgage professional and a real estate lawyer before making a purchase decision.</p></div>`;
}

// Section 3: every stored field, in reading order. Plain facts use factOrOmit
// (shown when present, silently omitted otherwise -- never "N/A"); the two money
// figures use moneyFactOrEstimate (real value, else a labelled estimate).
// Square footage, room sizes and other not-yet-stored fields are deliberately
// absent. Heating is PropTx HeatType (the delivery system, e.g. "Forced Air"),
// labelled "Heating" -- not "Heat source", which is a different PropTx field.
function fullListingFacts(listing) {
  const est = ldEstimates(listing);
  const yearSuffix = listing.taxYear ? ` (${listing.taxYear})` : "";
  const isCondo = listing.propertyType === "condo";
  const realFee = ldFeeToMonthly(listing.associationFee, listing.associationFeeFrequency);
  const lot = listing.lotSizeArea
    ? `${listing.lotSizeArea}${listing.lotSizeUnits ? " " + listing.lotSizeUnits : ""}`
    : null;
  return [
    factOrOmit("Property type", LD_TYPE_LABELS[listing.propertyType]),
    factOrOmit("Beds", listing.bedrooms),
    factOrOmit("Baths", listing.bathrooms),
    factOrOmit("Parking spaces", listing.parkingSpaces),
    factOrOmit("Total parking", listing.parkingTotal),
    factOrOmit("Garage", listing.garageType),
    factOrOmit("Basement", listing.basement),
    factOrOmit("Heating", listing.heatType),
    factOrOmit("Cooling", listing.cooling),
    factOrOmit("Year built", listing.yearBuilt),
    factOrOmit("Lot size", lot),
    moneyFactOrEstimate("Property tax", listing.taxAnnualAmount, est.taxAnnual, (v) => `${fmtPrice(v)}/yr${yearSuffix}`),
    isCondo
      ? moneyFactOrEstimate("Condo fee", realFee, est.condoFee, (v) => `${fmtPrice(v)}/mo`)
      : moneyFactOrEstimate("Association fee", realFee, null, (v) => `${fmtPrice(v)}/mo`),
    factOrOmit("City", listing.city),
    factOrOmit("Postal code", listing.postalCode),
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
    + `<div class="ld-income">`
    + ldRow("Estimated take-home income", `${fmtPrice(view.net)}/mo`)
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

// This page is normally reached from the listings popup (opened by
// openListingsWindow in listings-display.js), and navigates inside that same
// window, so it inherits whatever size the popup happens to have -- which the
// browser may have left small. When (and only when) this page is running
// inside a popup that has an opener, resize/move that window to fill the
// available screen so a listing always shows at full desktop size. resizeTo/
// moveTo set the OUTER window (unlike window.open's width/height, which only
// size the content area). A normal browser tab has no opener, so it is never
// touched; a browser that refuses the resize just leaves the window as it is.
// Takes the window as a parameter so it can be tested with a stub.
function ldFillPopupToScreen(w) {
  try {
    if (!w.opener || w.opener.closed) return false;
    const aw = w.screen.availWidth, ah = w.screen.availHeight;
    if (!(aw > 0 && ah > 0)) return false;
    if (w.outerWidth >= aw - 8 && w.outerHeight >= ah - 8) return false; // already full
    w.moveTo(0, 0);
    w.resizeTo(Math.max(1040, aw), Math.max(840, ah));
    return true;
  } catch (e) {
    return false;
  }
}

async function ldInit() {
  const root = document.getElementById("ldRoot");
  if (!root) return;
  ldFillPopupToScreen(window);
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
