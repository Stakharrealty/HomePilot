// listing-full.js -- the full listing page (listing-full.html?key=...).
//
// Shows every field the listings API stores for one listing: price, photo
// gallery, facts, the complete description, virtual tour, then the
// compliance block (brokerage + PROPTX notices). Fields PropTx did not supply
// are omitted silently -- never "N/A". Square footage, room sizes and the
// other not-yet-stored fields are deliberately absent (a later step).
//
// Reuses, rather than reimplements: factOrOmit / moneyFactOrEstimate / safeUrl
// / fmtPrice / renderIdxNotice / attachPhotoCarousel (listings-display.js) and
// ldEstimates / ldFeeToMonthly / LD_TYPE_LABELS (listing-fit.js) -- the same
// real-vs-estimated tax and condo-fee logic as the listing.html snapshot.
//
// No buyer data is read or sent; the one network call is GET /listing?key= on
// this app's own listings API (PropTx IDX Data Agreement Article 6.2(k)).

// Every stored field, in reading order. Plain facts use factOrOmit; the two
// money figures use moneyFactOrEstimate. Heating is PropTx HeatType (the
// delivery system), labelled "Heating".
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

function renderFullGallery(listing) {
  const photos = (Array.isArray(listing.photos) ? listing.photos : []).map(safeUrl).filter(Boolean);
  const cityEsc = escapeHtml(listing.city || "");
  const sec = document.createElement("section");
  sec.className = "ld-sec lf-gallery";
  sec.id = "lfGallery";
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

function renderFullDetails(listing) {
  const sec = document.createElement("section");
  sec.className = "ld-sec";
  sec.id = "lfDetails";
  const facts = fullListingFacts(listing);
  const tour = safeUrl(listing.virtualTourUrl);
  sec.innerHTML = `<h2>Property details</h2>` + (facts.length
    ? `<ul class="ld-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`
    : `<p class="ld-muted">No further details were provided for this listing.</p>`)
    + (tour ? `<a class="lf-tour listing-virtual-tour" href="${tour}" target="_blank" rel="noopener noreferrer">Virtual tour</a>` : "");
  return sec;
}

function renderFullRemarks(listing) {
  if (!listing.publicRemarks || !String(listing.publicRemarks).trim()) return null;
  const sec = document.createElement("section");
  sec.className = "ld-sec";
  sec.id = "lfRemarks";
  const h = document.createElement("h2");
  h.textContent = "Description";
  const p = document.createElement("div");
  p.className = "lf-remarks";
  p.textContent = String(listing.publicRemarks); // full, untruncated
  sec.appendChild(h);
  sec.appendChild(p);
  return sec;
}

// Brokerage (Article 6.3(c): same size/weight as the other details) and the
// two PROPTX notices, exactly as on the listing card and listing.html.
function renderFullCompliance(listing) {
  const wrap = document.createElement("div");
  wrap.className = "ld-compliance";
  const brokerage = document.createElement("div");
  brokerage.className = "listing-brokerage";
  brokerage.textContent = `Listed by ${listing.brokerageName || "Brokerage not available"}`;
  wrap.appendChild(brokerage);
  wrap.appendChild(renderIdxNotice());
  return wrap;
}

function lfBackHref(listing) {
  const city = listing.cityRegion || (String(listing.city || "").startsWith("Toronto") ? "Toronto" : listing.city);
  return city ? `listings.html?city=${encodeURIComponent(city)}` : "listings.html";
}

function renderFullListing(root, listing) {
  root.textContent = "";
  const head = document.createElement("div");
  head.className = "ld-head";
  const title = listing.displayAddress ? escapeHtml(listing.displayAddress) : escapeHtml(listing.city || "Listing");
  const price = Number(listing.listPrice) > 0 ? `<div class="ld-price">${escapeHtml(fmtPrice(Number(listing.listPrice)))}</div>` : "";
  head.innerHTML = `<h1>${title}</h1>` + (listing.displayAddress && listing.city ? `<div class="ld-sub">${escapeHtml(listing.city)}</div>` : "") + price;
  root.appendChild(head);
  root.appendChild(renderFullGallery(listing));
  root.appendChild(renderFullDetails(listing));
  const remarks = renderFullRemarks(listing);
  if (remarks) root.appendChild(remarks);
  root.appendChild(renderFullCompliance(listing));
  const back = document.getElementById("ldBack");
  if (back) back.setAttribute("href", lfBackHref(listing));
}

async function lfInit() {
  const root = document.getElementById("lfRoot");
  if (!root) return;
  const key = new URLSearchParams(window.location.search).get("key");
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
  renderFullListing(root, listing);
}

lfInit();
