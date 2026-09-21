// HomePilot — listing display (src/listings-display.js)
// Added 2026-07-22. Renders listings pulled from the homepilot-listings
// Worker's D1 database, via GET /listings?city=X.
//
// INCOM WAS FULLY REMOVED 2026-07-22 (see utils.js). This is the only
// listings experience in the app -- and as of 2026-07-25, it's no longer
// an inline expand panel under each city card either (see
// openListingsWindow() below and listings.html): "View Available Homes"
// buttons now open a dedicated separate listings page/popup, per explicit
// product direction that listings should support HomePilot's
// recommendation, not become a browsing experience embedded in it.
//
// DDF REMOVED 2026-09-18: CREA's DDF Policy and Rules (section 6) required
// a REALTOR.ca attribution mark, the REALTOR® logo, and a specific CREA
// trademark statement on every rendered listing. None of that applies now
// that DDF is gone -- see the removal notes near fetchListings() and
// renderLiveListings() below. Brokerage name display stayed (it's a
// source-agnostic, not DDF-specific, requirement). PropTx's IDX Data
// Agreement has its own required disclaimer wording -- add that once
// confirmed against the actual agreement text, not this comment.

const LISTINGS_API_BASE = "https://homepilot-listings.stakharrealty.workers.dev";

// DDF's mandatory CREA view-tracking analytics call (LogEvents.svc) was
// removed here along with the rest of the DDF pipeline (2026-09-18). It was
// a DDF-specific compliance requirement (CREA DDF Policy and Rules, rule
// 5c), tied to a DestinationID CREA issued specifically for the DDF feed --
// it does not apply to IDX and there is no PropTx equivalent wired in yet.
// If PropTx's agreement has its own required tracking/analytics call,
// implement that separately here once confirmed against the actual PropTx
// spec -- do not resurrect the CREA endpoint/DestinationID for it.

// --- Data fetching ---

// PAGE_LIMIT (renamed from a fixed display cap, 2026-07-24): this is now
// just the page SIZE for "Load more" pagination, not a ceiling on total
// listings shown -- a buyer can page through everything stored for their
// city/type via the Load More button (see loadMoreListings() below).
const PAGE_LIMIT = 24;

// IDX_MAX_LISTINGS_PER_SEARCH (added 2026-09-18): PROPTX IDX Data
// Agreement Article 6.3(b) -- a buyer may view at most 100 listings in
// response to one inquiry. Enforced server-side in the listings Worker
// (the real limit); mirrored here so "Load more" stops at 100 with a
// clear note instead of an empty click.
const IDX_MAX_LISTINGS_PER_SEARCH = 100;

// Required PropTx notices, worded per the signed PROPTX IDX Data
// Agreement: Article 6.3(i) (deemed reliable, not guaranteed by PROPTX)
// and 6.3(k) (bona fide interest -- the agreement's own suggested wording,
// verbatim). Shown with every set of listings. Do not reword.
const IDX_NOTICE_RELIABLE = "Listing information is deemed reliable but is not guaranteed accurate by PROPTX.";
const IDX_NOTICE_BONA_FIDE = "The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose.";

function renderIdxNotice() {
  const el = document.createElement("div");
  el.className = "listings-idx-notice";
  const p1 = document.createElement("p");
  p1.textContent = IDX_NOTICE_RELIABLE;
  const p2 = document.createElement("p");
  p2.textContent = IDX_NOTICE_BONA_FIDE;
  el.appendChild(p1);
  el.appendChild(p2);
  return el;
}

function renderCapNote() {
  const el = document.createElement("div");
  el.className = "listings-cap-note";
  el.textContent = `That's the most homes one search can show (${IDX_MAX_LISTINGS_PER_SEARCH}). Pick a home type to narrow it down.`;
  return el;
}

// searchBudget (added 2026-07-29, affordability-consistency fix): when
// provided, the API applies the SAME 10%-stretch ceiling already used
// elsewhere in the app (see STRETCH_MULTIPLIER in db.js) -- e.g.
// buyPower*1.10 -- so listings above that range are excluded server-side,
// not just visually de-emphasized. Optional and validated: an invalid or
// missing value means no price ceiling is applied (matches prior
// behavior exactly, so existing/older callers are unaffected).
async function fetchListings(city, propertyType, offset = 0, limit = PAGE_LIMIT, searchBudget = null) {
  const params = new URLSearchParams({ city, limit: String(limit), offset: String(offset) });
  if (propertyType && propertyType !== "all") params.set("type", propertyType);
  if (Number.isFinite(searchBudget) && searchBudget > 0) params.set("budget", String(searchBudget));
  const resp = await fetch(`${LISTINGS_API_BASE}/listings?${params.toString()}`);
  if (!resp.ok) throw new Error(`Listings fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.listings || [];
}

// --- Rendering ---

function fmtPrice(n) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

// escapeHtml() is defined in ai.js and shared globally (plain <script> tags,
// same pattern as every other module here) -- ai.js loads before this file
// in index.html. Not redefined here to avoid two copies drifting apart.
//
// XSS fix, 2026-07-23: brokerageName, city, and listingUrl/photo URLs all
// come straight from CREA's DDF feed and were being inserted into
// innerHTML unescaped -- a real gap against this codebase's own
// established escapeHtml() rule (see ai.js). Fixed here.

// escapeHtml() alone doesn't stop a malicious `javascript:` URL from being
// dropped into an href/src -- neutralizes that separately by only ever
// allowing https:// URLs through (CREA/REALTOR.ca URLs are always https
// anyway). Anything else is treated as absent.
function safeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed : "";
}

// factOrOmit: a plain fact that simply doesn't appear when the value is
// absent -- never "N/A" / "Not available". Returns escaped text or null.
function factOrOmit(label, value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : `${label}: ${escapeHtml(text)}`;
}

// moneyFactOrEstimate: for financial figures only (property tax, condo
// fee). The real value wins; if it's missing (null/undefined/non-numeric/
// not positive), an estimate supplied by the caller is shown and labelled
// "(estimated)"; if neither exists, null (omitted). formatFn turns a number
// into display text; its output is escaped here.
function moneyFactOrEstimate(label, realValue, estimateValue, formatFn) {
  const usable = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
  if (usable(realValue)) return `${label}: ${escapeHtml(formatFn(Number(realValue)))}`;
  if (usable(estimateValue)) return `${label} (estimated): ${escapeHtml(formatFn(Number(estimateValue)))}`;
  return null;
}

// Listed date -> { y, m, d } (the Toronto calendar day), or null.
// PropTx's OriginalEntryTimestamp is UTC ("2026-01-08T17:33:04Z"), so a
// timestamp is converted to the Toronto calendar day (a late-evening entry
// must not show as the next day). A bare date is used as-is. Anything
// unparseable is treated as absent.
function listedDateParts(value) {
  const str = String(value == null ? "" : value).trim();
  let ymd = str;
  if (/^\d{4}-\d{2}-\d{2}[T ].*(Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const t = new Date(str);
    if (Number.isNaN(t.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    ymd = `${p.year}-${p.month}-${p.day}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]), mon = Number(m[2]), day = Number(m[3]);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return { y, m: mon, d: day };
}

// Listed date for the card, rendered like "Sep 12, 2026".
function formatListedDate(value) {
  const p = listedDateParts(value);
  if (!p) return null;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.m - 1]} ${p.d}, ${p.y}`;
}

// How long ago the listing was listed, computed live from the listed date at
// render time: "Listed Today" (0 days, or a date in the future from timezone
// edges), "1 Day Ago", "N Days Ago". Whole Toronto calendar days, so it
// matches the date shown. null when there is no listed date -- never invented.
// `now` is injectable for tests.
function listedDaysAgoText(value, now = new Date()) {
  const p = listedDateParts(value);
  if (!p) return null;
  const t = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const days = Math.max(0, Math.round((Date.UTC(Number(t.year), Number(t.month) - 1, Number(t.day)) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000));
  if (days === 0) return "Listed Today";
  return days === 1 ? "1 Day Ago" : `${days} Days Ago`;
}

// searchBudget (added 2026-07-29): the same recommended-price number the
// buyer was shown on the card that opened this listings view (or their
// overall buyPower, for the "all types" city-level entry point -- see
// openListingsWindow()). Used ONLY to decide the badge below -- the actual
// price ceiling (searchBudget * 1.10) is already enforced server-side in
// getListingsByCity(), so every listing reaching this function is
// guaranteed to be at or under that stretch ceiling already. null/absent
// means no budget context was passed (e.g. an older bookmarked listings.html
// URL) -- no badge is shown in that case, not a guessed one.
function renderListingCard(listing, searchBudget) {
  // Every photo the API returned (no cap), https-only. The card renders ONE
  // <img> and swaps its src on demand (arrows / swipe), so only the photo
  // being viewed is ever downloaded -- never the whole set up front.
  const photos = (Array.isArray(listing.photos) ? listing.photos : []).map(safeUrl).filter(Boolean);
  const photo = photos[0] || "";
  // Card facts. factOrOmit drops any that aren't stored (never "N/A").
  // Everything else (garage, basement, tax, fee, tour, description ...) lives
  // only on listing.html -- the card has no expandable panel.
  //   - bedsBathsRow: its own row under the address.
  //   - listedDateFact + listedDateAgo: top-right, beside the price; the age
  //     ("16 Days Ago") is computed live from the listed date on every render.
  const bedsBathsRow = [
    factOrOmit("Beds", listing.bedrooms),
    factOrOmit("Baths", listing.bathrooms),
  ].filter(Boolean).join(" · ");
  const listedDateFact = factOrOmit("Listed", formatListedDate(listing.listedDate));
  const listedDateAgo = listedDateFact ? listedDaysAgoText(listing.listedDate) : null;
  // MLS segment is omitted until the row has been backfilled by an ingest.
  const mlsText = listing.mlsNumber == null ? "" : String(listing.mlsNumber).trim();
  const mlsFact = mlsText ? escapeHtml(mlsText) : null;
  const brokerage = escapeHtml(listing.brokerageName || "Brokerage not available");
  const cityEsc = escapeHtml(listing.city || "");

  // affordabilityBadge (product decision, Sandeep): the 10% price ceiling is
  // enforced first and is unchanged (server-side in getListingsByCity, and
  // again in listingFit()); for a listing inside it, the badge is the app's
  // own getFit() tier -- monthly cost as a share of the buyer's net take-home:
  // "Great fit" / "Good Fit" / "Stretch" -- the same tiers, colours and i18n
  // labels as the results page, and identical to the badge on the detail page
  // (both come from listingFit() in listing-fit.js). No buyer profile (a
  // shared link, blocked storage) or no budget means no badge, never a
  // guessed one.
  const fit = typeof listingFit === "function" && typeof loadBuyerProfile === "function"
    ? listingFit(listing, loadBuyerProfile(), searchBudget)
    : null;
  const affordabilityBadge = fit ? { cls: "listing-fit-" + fit.cls, label: fit.lbl } : null;

  // The buyer's total monthly cost for this home (one number, no label; the
  // line-by-line breakdown lives on listing.html). Same calcCosts() engine and
  // the same real-PropTx-overrides-estimates rule as the detail page -- see
  // listingMonthlyCost() in listing-fit.js. No profile / no price: no number.
  const monthlyCost = typeof listingMonthlyCost === "function" && typeof loadBuyerProfile === "function"
    ? listingMonthlyCost(listing, loadBuyerProfile())
    : null;

  // displayAddress is already consent-gated server-side (see
  // consentGatedAddress() in db.js) -- truthy here means CREA explicitly
  // confirmed the seller allowed it to be shown. Never fall back to
  // postalCode or anything else if it's absent; absent means "don't show
  // an address for this listing", not "show what we have instead".
  const addressEsc = listing.displayAddress ? escapeHtml(listing.displayAddress) : null;

  // Link to this listing's HomePilot detail page. Same-window navigation (no
  // target=_blank / noopener): the buyer's numbers travel in sessionStorage,
  // which a noopener new tab would not receive. The budget is the price the
  // buyer was shown on the card that led here -- not personal data.
  const detailKey = /^[A-Za-z0-9_-]{1,40}$/.test(String(listing.listingKey || "")) ? String(listing.listingKey) : "";
  const detailBudget = Number.isFinite(searchBudget) && searchBudget > 0 ? `&budget=${encodeURIComponent(String(searchBudget))}` : "";
  const detailHref = detailKey ? `listing.html?key=${encodeURIComponent(detailKey)}${detailBudget}` : "";

  const card = document.createElement("div");
  card.className = "listing-card";
  card.innerHTML = `
    <div class="listing-photo-wrap${detailHref ? " listing-photo-wrap-clickable" : ""}">
      ${photo
        ? `<img class="listing-photo" src="${photo}" alt="Photo of listing in ${cityEsc}" loading="lazy">`
        : `<div class="listing-photo listing-photo-empty">No photo available</div>`}
      ${photos.length > 1 ? `
      <button type="button" class="listing-photo-nav listing-photo-prev" aria-label="Previous photo">‹</button>
      <button type="button" class="listing-photo-nav listing-photo-next" aria-label="Next photo">›</button>
      <span class="listing-photo-counter" aria-live="polite">1/${photos.length}</span>` : ""}
    </div>
    <div class="listing-body">
      <div class="listing-price-row">
        <span class="listing-price">${fmtPrice(listing.listPrice)}${affordabilityBadge ? ` <span class="listing-affordability-badge ${affordabilityBadge.cls}">${escapeHtml(affordabilityBadge.label)}</span>` : ""}</span>
        ${listedDateFact ? `
          <span class="listing-listed-date-group">
            <span class="listing-listed-date">${listedDateFact}</span>
            ${listedDateAgo ? `<span class="listing-listed-date-ago">${listedDateAgo}</span>` : ""}
          </span>
        ` : ""}
      </div>
      ${addressEsc ? `<div class="listing-address">${addressEsc}</div>` : ""}
      ${bedsBathsRow || monthlyCost ? `<div class="listing-meta listing-facts-row">${bedsBathsRow ? `<span class="listing-facts-text">${bedsBathsRow}</span>` : ""}${monthlyCost ? `<span class="listing-monthly-cost">${escapeHtml(fmtPrice(monthlyCost))}/mo</span>` : ""}</div>` : ""}
      ${detailHref ? `<div class="listing-links">
        <a class="listing-detail-link" href="${escapeHtml(detailHref)}">Full HomePilot Analysis</a>
      </div>` : ""}
      <div class="listing-brokerage">${mlsFact ? `${mlsFact} · ` : ""}Listed by ${brokerage}</div>
    </div>
  `;

  if (photos.length > 1) attachPhotoCarousel(card, photos, cityEsc);

  // Thumbnail click -> same listing.html page as the "Full HomePilot
  // Analysis" pill (same-window navigation, same reason: the buyer's
  // numbers travel in sessionStorage, which a new tab wouldn't receive).
  // Nav-button clicks already call stopPropagation() in
  // attachPhotoCarousel(), so they never reach this listener. tabindex/
  // role/keydown make it reachable without a mouse too -- not just a
  // decoration on top of the pill link.
  if (detailHref) {
    const photoWrap = card.querySelector(".listing-photo-wrap");
    photoWrap.tabIndex = 0;
    photoWrap.setAttribute("role", "link");
    photoWrap.setAttribute("aria-label", "View full HomePilot analysis for this listing");
    photoWrap.addEventListener("click", () => { window.location.href = detailHref; });
    photoWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.location.href = detailHref; }
    });
  }

  return card;
}

// Card-level photo carousel: prev/next buttons (shown on hover in CSS) and
// horizontal swipe on touch. Swaps the single <img>'s src to photos[i]; the
// browser fetches only that one file. Wraps around at both ends. No
// preloading of neighbours, by design (see renderListingCard).
const SWIPE_MIN_PX = 40;
function attachPhotoCarousel(card, photos, cityEsc) {
  const wrap = card.querySelector(".listing-photo-wrap");
  const img = wrap.querySelector("img.listing-photo");
  const counter = wrap.querySelector(".listing-photo-counter");
  let idx = 0;

  function show(i) {
    idx = (i + photos.length) % photos.length;
    img.src = photos[idx];
    img.alt = `Photo ${idx + 1} of ${photos.length} of listing in ${cityEsc}`;
    counter.textContent = `${idx + 1}/${photos.length}`;
  }

  wrap.querySelector(".listing-photo-prev").addEventListener("click", (e) => { e.stopPropagation(); show(idx - 1); });
  wrap.querySelector(".listing-photo-next").addEventListener("click", (e) => { e.stopPropagation(); show(idx + 1); });

  let startX = null, startY = null;
  wrap.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
  }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    startX = startY = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? idx + 1 : idx - 1);
  }, { passive: true });
}

const TYPE_LABELS_PLURAL = { condo: "Condos", town: "Townhomes", semi: "Semi-Detached Homes", detached: "Detached Homes", all: "Homes" };
const TYPE_LABELS_LOWER = { condo: "condo", town: "townhouse", semi: "semi-detached", detached: "detached home" };

// Property-type filter pills on the listings page (listings.html) -- same
// look and same 5 options as the "Property Type" filter bar under the
// calculator's own results (calculator.html: #pt-all/condo/town/semi/detached,
// filtProp()), so a buyer sees a familiar control after landing here from a
// recommendation card. Unlike the calculator's filter (which re-slices
// already-loaded city data client-side), picking a pill here re-fetches
// listings for the new type by calling renderLiveListings() again.
const TYPE_FILTER_OPTIONS = [["all", "All"], ["condo", "Condos"], ["town", "Townhomes"], ["semi", "Semi-Detached"], ["detached", "Detached"]];

// Built as real DOM with a bound callback (not a global onclick + class
// lookup) so it works with whatever containerEl the caller passes in --
// same pattern as attachPhotoCarousel() above -- rather than depending on
// listings.html's specific container class.
function buildTypeFilterBar(propertyType, onSelect) {
  const active = TYPE_LABELS_PLURAL[propertyType] ? propertyType : "all";
  const wrap = document.createElement("div");
  wrap.className = "filter-group";
  const label = document.createElement("div");
  label.className = "filter-label";
  label.textContent = "Property Type";
  const filters = document.createElement("div");
  filters.className = "filters";
  for (const [value, text] of TYPE_FILTER_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fb" + (value === active ? " on" : "");
    btn.textContent = text;
    btn.addEventListener("click", () => onSelect(value));
    filters.appendChild(btn);
  }
  wrap.appendChild(label);
  wrap.appendChild(filters);
  return wrap;
}

// Inserts the filter bar right after ".listings-page-header" (title +
// subtitle), before whatever loading/empty/error/grid content follows it --
// works regardless of what's already in containerEl, since content appended
// afterward (e.g. the grid) lands after this insertion point, not before it.
function insertTypeFilterBar(containerEl, propertyType, onSelect) {
  const header = containerEl.querySelector(".listings-page-header");
  const bar = buildTypeFilterBar(propertyType, onSelect);
  if (header) header.insertAdjacentElement("afterend", bar);
  else containerEl.insertBefore(bar, containerEl.firstChild);
}

// Fetches the next page for an already-open listings container and appends
// it to the existing grid, rather than re-rendering from scratch -- keeps
// already-loaded cards (and their view-tracking observers) intact.
async function loadMoreListings(buttonEl) {
  const containerEl = buttonEl.closest(".live-listings-container");
  const state = containerEl && containerEl._hpListingsState;
  if (!state) return;

  buttonEl.disabled = true;
  buttonEl.textContent = "Loading more…";

  try {
    const nextOffset = state.offset + PAGE_LIMIT;
    const requested = Math.min(PAGE_LIMIT, IDX_MAX_LISTINGS_PER_SEARCH - nextOffset);
    if (requested <= 0) {
      buttonEl.replaceWith(renderCapNote());
      return;
    }
    const listings = await fetchListings(state.city, state.propertyType, nextOffset, requested, state.searchBudget);
    for (const listing of listings) {
      state.grid.appendChild(renderListingCard(listing, state.searchBudget));
    }
    state.offset = nextOffset;
    if (listings.length < requested) {
      buttonEl.remove(); // that was the last page -- nothing more to load
    } else if (nextOffset + listings.length >= IDX_MAX_LISTINGS_PER_SEARCH) {
      buttonEl.replaceWith(renderCapNote()); // Article 6.3(b) 100-listing limit reached
    } else {
      buttonEl.disabled = false;
      buttonEl.textContent = "Load more homes";
    }
  } catch {
    buttonEl.disabled = false;
    buttonEl.textContent = "Couldn't load more — try again";
  }
}
window.loadMoreListings = loadMoreListings;

// --- Public entry point ---
// Renders live DDF listings for a city (optionally filtered to one
// property type) into the given container element -- called by
// listings.html, the dedicated standalone listings page (2026-07-25
// redesign; previously called from an inline expand panel under each city
// card, now called once per page load on listings.html itself).
//
// Header framing is deliberate product language, not incidental copy:
// "Available Condos Matching This Recommendation" (what this shows), never
// "All Listings in Brampton" (what a generic portal would show) -- the
// listings support HomePilot's recommendation, they aren't a separate
// browsing experience. See the product brief this was built from.
// searchBudget (added 2026-07-29): the recommended price shown on whichever
// card/context opened this view -- see openListingsWindow() below for how
// it's chosen (card's own displayed price vs. overall buyPower). Threaded
// through to fetchListings (server-side price ceiling) and every rendered
// card (client-side fit-tier badge from getFit(); see listing-fit.js).
async function renderLiveListings(city, containerEl, propertyType, searchBudget) {
  containerEl._hpListingsState = { city, propertyType, searchBudget };
  const cityEsc = escapeHtml(city);
  const typeLabelPlural = TYPE_LABELS_PLURAL[propertyType] || "Homes";
  // typePhraseLower is only used as an adjective before "listings" -- when
  // no propertyType is given (or it's not one of the 4 known types), this
  // must be "" (producing plain "listings"), not a fallback word like
  // "home" (which would read as "home listings", a real regression this
  // was fixed from -- the exact phrase "No active listings" is also relied
  // on by tests/listings_frontend_display_test.js).
  const typePhraseLower = TYPE_LABELS_LOWER[propertyType] || "";
  const loadingPhrase = typePhraseLower ? `${typePhraseLower} listings` : "listings";
  const headerHtml = `
    <div class="listings-page-header">
      <div class="listings-page-title">Available ${escapeHtml(typeLabelPlural)} Matching This Recommendation</div>
      <div class="listings-page-subtitle">${cityEsc} · HomePilot Affordability Pick</div>
    </div>`;
  // Re-fetches for the clicked type, keeping the same city and search
  // budget, and reflects the choice in the URL (replaceState, not
  // pushState -- a filter pick isn't a new page to go "back" through).
  const onSelectType = (type) => {
    if (typeof window !== "undefined" && window.history && window.location) {
      const url = new URL(window.location.href);
      if (type === "all") url.searchParams.delete("type");
      else url.searchParams.set("type", type);
      window.history.replaceState(null, "", url);
    }
    renderLiveListings(city, containerEl, type, searchBudget);
  };
  containerEl.innerHTML = `${headerHtml}<div class="listings-loading">Loading live ${escapeHtml(loadingPhrase)} for ${cityEsc}…</div>`;
  insertTypeFilterBar(containerEl, propertyType, onSelectType);

  try {
    const listings = await fetchListings(city, propertyType, 0, PAGE_LIMIT, searchBudget);

    if (listings.length === 0) {
      containerEl.innerHTML = `${headerHtml}<div class="listings-empty">No active ${escapeHtml(loadingPhrase)} found in ${cityEsc} right now. Check back soon.</div>`;
      insertTypeFilterBar(containerEl, propertyType, onSelectType);
      return;
    }

    containerEl.innerHTML = headerHtml;
    insertTypeFilterBar(containerEl, propertyType, onSelectType);
    const grid = document.createElement("div");
    grid.className = "listings-grid";
    for (const listing of listings) {
      grid.appendChild(renderListingCard(listing, searchBudget));
    }
    containerEl.appendChild(grid);

    // Track pagination state on the container itself so loadMoreListings()
    // can pick up where this left off.
    containerEl._hpListingsState = { city, propertyType, offset: 0, grid, searchBudget };

    if (listings.length === PAGE_LIMIT && PAGE_LIMIT < IDX_MAX_LISTINGS_PER_SEARCH) {
      // A full page came back -- there may be more. Rather than firing an
      // extra COUNT query, the button itself resolves this: clicking it
      // fetches the next page, and removes itself once a short page proves
      // there's nothing left.
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.type = "button";
      loadMoreBtn.className = "listings-load-more";
      loadMoreBtn.textContent = "Load more homes";
      loadMoreBtn.onclick = () => loadMoreListings(loadMoreBtn);
      containerEl.appendChild(loadMoreBtn);
    }

    // PropTx Article 6.3(i) and 6.3(k) notices -- always under the
    // listings (and below "Load more", which stays above them).
    containerEl.appendChild(renderIdxNotice());
  } catch (err) {
    containerEl.innerHTML = `${headerHtml}<div class="listings-error">Couldn't load live listings right now. Please try again shortly.</div>`;
    insertTypeFilterBar(containerEl, propertyType, onSelectType);
  }
}

// Exposed for listings.html to call once it loads.
window.renderLiveListings = renderLiveListings;

// --- Entry point from HomePilot's main recommendation cards ---
// REDESIGNED 2026-07-25, replacing the old toggleLiveListings() inline
// expand/collapse: per explicit product direction, listings must not be
// embedded inside city cards or expand inline beneath a recommendation --
// they open in a dedicated HomePilot listings experience (listings.html),
// framed as "Available Condos Matching This Recommendation", not "All
// Listings in Brampton". This keeps HomePilot's role as a decision engine
// front and center; listings support that decision, they don't replace it.
//
// Desktop: a real, separate OS popup window (window.open()), per explicit
// direction. Mobile: real URL navigation with a native back button (also
// explicit direction) -- not a same-window in-app overlay, so the phone's
// own back gesture/button works for free and the URL is shareable.
//
// DESKTOP_BREAKPOINT_PX matches the app's own existing @media(min-width:1024px)
// breakpoint in index.html's CSS (the true desktop grid-layout tier), not a
// new arbitrary number.
const DESKTOP_BREAKPOINT_PX = 1024;

// CRITICAL popup-blocker constraint: window.open() must be the very FIRST
// thing that happens in this function, called synchronously from the click
// handler -- no fetch/await/anything before it. Browsers only allow
// window.open() through if it happens inside the same synchronous tick as
// the user's click; any async work first (even a fast API call) makes the
// browser treat the eventual window.open() as an unrequested popup and
// silently block it, no error, no visible failure. So this function opens
// the window (or navigates, on mobile) IMMEDIATELY, pointed at a real URL
// that does its own fetching once loaded -- it never fetches data itself
// before opening/navigating.
// searchBudget (added 2026-07-29, affordability-consistency fix): the
// recommended price the buyer was just shown -- passed by render.js as the
// 3rd argument at BOTH call sites, with different meaning by context (per
// explicit product decision, 2026-07-29):
//   - Property-type recommendation cards/panels (Detached/Semi/Town/Condo):
//     the EXACT number displayed on that card (render.js's `displayPrice`/
//     `price`) -- so the listings search never uses a different number than
//     what the buyer just looked at.
//   - City-level "View All Homes" (no single type/price shown): the
//     buyer's overall buyPower, since there's no specific on-screen number
//     to match in that context.
// Optional/validated -- an invalid or missing value just omits the budget
// param entirely, matching prior behavior (no price ceiling) exactly.
function openListingsWindow(city, propertyType, searchBudget) {
  // Hand the buyer's own numbers to the listing detail page (sessionStorage,
  // synchronous, never the URL -- see buyer-profile.js). Written BEFORE the
  // window opens because a popup gets a copy of sessionStorage at open time.
  if (typeof saveBuyerProfile === "function") saveBuyerProfile();
  const paramsObj = { city, type: propertyType || "all" };
  if (Number.isFinite(searchBudget) && searchBudget > 0) paramsObj.budget = String(searchBudget);
  const params = new URLSearchParams(paramsObj);
  const url = `listings.html?${params.toString()}`;

  const isDesktop = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`).matches;

  if (isDesktop) {
    // Named target ("hp_listings") means clicking a second "View Available
    // Homes" button re-focuses the same popup and navigates it to the new
    // city/type, rather than piling up multiple popup windows.
    // NOTE: deliberately no "noopener" here -- noopener makes window.open()
    // always return null BY DESIGN (the browser refuses to hand back a
    // reference), which broke the very check on the next line: `if (popup)`
    // was always false, so every desktop click fell through to the mobile
    // fallback and navigated the CURRENT tab away instead of opening a
    // separate window -- confirmed live 2026-07-25 (a real mouse click,
    // not a script-simulated one, still hit this). This function needs the
    // real popup reference (to .focus() it on repeat clicks, and to
    // legitimately detect an actual browser-level block), so noopener and
    // "check if popup is truthy" can't be combined.
    const popup = window.open(url, "hp_listings", "width=1040,height=840,scrollbars=yes,resizable=yes");
    if (popup) popup.focus();
    // If popup is still null here, that's now a REAL block (e.g. the user
    // has popups hard-disabled) -- fall back to same-tab navigation rather
    // than silently doing nothing.
    else window.location.href = url;
  } else {
    // Mobile: real navigation, not an in-app overlay -- gives the phone's
    // native back button and a shareable/bookmarkable URL for free.
    window.location.href = url;
  }
}
window.openListingsWindow = openListingsWindow;
