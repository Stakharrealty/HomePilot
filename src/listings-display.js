// HomePilot — DDF listing display (src/listings-display.js)
// Added 2026-07-22. Renders real CREA/DDF listings pulled from the
// homepilot-listings Worker's D1 database, via GET /listings?city=X.
//
// INCOM WAS FULLY REMOVED 2026-07-22 (see utils.js). This is no longer an
// additive/"Beta" option alongside INCOM -- every "View Available Homes"
// button (render.js, render-support.js) now calls toggleLiveListings()
// below directly, and is the only listings experience in the app. This
// comment previously said otherwise; corrected 2026-07-23 to match reality
// -- the code had already moved on, the comment hadn't.
//
// COMPLIANCE NOTE (CREA DDF Policy and Rules, section 6 -- confirmed via
// the official PDF this session, not assumed): every rendered listing must
// show a "Powered by REALTOR.ca" mark linking to the listing on REALTOR.ca,
// the brokerage name in readable text (not hidden behind a click), and
// must not be wrapped in any advertising/co-branding. This module attempts
// to satisfy all three. The REALTOR® logo asset (src/assets/realtor-r.svg)
// and the exact CREA trademark wording were both sourced from the real
// REALTOR.ca site footer, 2026-07-22 -- not placeholders, not paraphrased.

const LISTINGS_API_BASE = "https://homepilot-listings.stakharrealty.workers.dev";
const ANALYTICS_ENDPOINT = "https://analytics.crea.ca/LogEvents.svc/LogEvents";
const DESTINATION_ID = 66674; // Issued by CREA for myhomepilot.ca, case #00258976, 2026-07-22

// --- Analytics: view tracking (mirrors workers/homepilot-listings/src/analytics.js) ---
//
// A stable per-browser UUID, per CREA's spec ("This ID should be the same
// for all requests from a single user/device"). This is a real production
// website (not a Claude artifact), so localStorage is the correct choice
// here for cross-session persistence -- unlike a sandboxed artifact
// preview, real browsers on myhomepilot.ca support it normally.
function getOrCreateAnalyticsUUID() {
  const KEY = "hp_analytics_uuid";
  try {
    let uuid = localStorage.getItem(KEY);
    if (!uuid) {
      uuid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, uuid);
    }
    return uuid;
  } catch {
    // localStorage can throw in rare privacy-mode edge cases -- fall back
    // to a per-page-load UUID rather than breaking the view entirely.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Fire-and-forget per CREA's own spec ("No response handling is required").
// Uses sendBeacon where available (survives page navigation), falls back to
// a keepalive fetch. Never awaited by callers, never blocks rendering.
function trackListingView(listingId) {
  try {
    const uuid = getOrCreateAnalyticsUUID();
    const params = new URLSearchParams({
      ListingID: String(listingId),
      DestinationID: String(DESTINATION_ID),
      EventType: "view",
      UUID: uuid,
      LanguageID: (window.currentLang === "fr" ? "2" : "1"),
    });
    const url = `${ANALYTICS_ENDPOINT}?${params.toString()}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      fetch(url, { keepalive: true }).catch(() => {});
    }
  } catch {
    // Analytics must never break the listing display itself.
  }
}

// Fires a view event once a listing card is actually scrolled into view,
// not merely rendered off-screen in a scrollable list -- closer to what
// CREA's "view" event is meant to represent. Fires only once per card.
function observeForViewTracking(cardEl, listingId) {
  if (!("IntersectionObserver" in window)) {
    trackListingView(listingId); // no IO support -- fall back to render-time
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          trackListingView(listingId);
          observer.disconnect();
        }
      }
    },
    { threshold: 0.5 }
  );
  observer.observe(cardEl);
}

// --- Data fetching ---

// PAGE_LIMIT (renamed from a fixed display cap, 2026-07-24): this is now
// just the page SIZE for "Load more" pagination, not a ceiling on total
// listings shown -- a buyer can page through everything stored for their
// city/type via the Load More button (see loadMoreListings() below).
const PAGE_LIMIT = 24;

async function fetchListings(city, propertyType, offset = 0, limit = PAGE_LIMIT) {
  const params = new URLSearchParams({ city, limit: String(limit), offset: String(offset) });
  if (propertyType && propertyType !== "all") params.set("type", propertyType);
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

function renderListingCard(listing) {
  const rawPhoto = listing.photos && listing.photos.length > 0 ? listing.photos[0] : null;
  const photo = safeUrl(rawPhoto);
  const beds = listing.bedrooms != null ? `${listing.bedrooms} bd` : null;
  const baths = listing.bathrooms != null ? `${listing.bathrooms} ba` : null;
  const bedsBaths = escapeHtml([beds, baths].filter(Boolean).join(" · "));
  const brokerage = escapeHtml(listing.brokerageName || "Brokerage not available");
  const cityEsc = escapeHtml(listing.city || "");
  const listingUrl = safeUrl(listing.listingUrl) || "#";

  const card = document.createElement("div");
  card.className = "listing-card";
  card.innerHTML = `
    <div class="listing-photo-wrap">
      ${photo
        ? `<img class="listing-photo" src="${photo}" alt="Photo of listing in ${cityEsc}" loading="lazy">`
        : `<div class="listing-photo listing-photo-empty">No photo available</div>`}
      <span class="listing-verified-seal" title="Sourced directly from CREA's DDF® feed, not scraped or estimated">Verified · CREA DDF®</span>
    </div>
    <div class="listing-body">
      <div class="listing-price">${fmtPrice(listing.listPrice)}</div>
      ${bedsBaths ? `<div class="listing-meta">${bedsBaths}</div>` : ""}
      <div class="listing-brokerage">Listed by ${brokerage}</div>
      <a class="listing-realtor-badge" href="${listingUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        <img class="listing-realtor-badge-logo" src="src/assets/realtor-r.svg" alt="REALTOR® logo" width="16" height="18">
        <span class="listing-realtor-badge-mark">Powered by REALTOR.ca</span>
        <span class="listing-realtor-badge-arrow">→</span>
      </a>
    </div>
  `;

  observeForViewTracking(card, listing.listingKey);
  return card;
}

const TYPE_LABELS = { condo: "condo", town: "townhouse", semi: "semi-detached", detached: "detached home" };

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
    const listings = await fetchListings(state.city, state.propertyType, nextOffset);
    for (const listing of listings) {
      state.grid.appendChild(renderListingCard(listing));
    }
    state.offset = nextOffset;
    if (listings.length < PAGE_LIMIT) {
      buttonEl.remove(); // that was the last page -- nothing more to load
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
// property type) into the given container element. propertyType is one of
// 'condo'/'town'/'semi'/'detached', or 'all'/omitted for no filter. Shows
// every listing stored for that city/type via "Load more" pagination
// (2026-07-24) -- no longer capped at a single fixed-size batch; per
// Sandeep, a buyer should be able to see everything they qualify for.
async function renderLiveListings(city, containerEl, propertyType) {
  const cityEsc = escapeHtml(city);
  const typeLabel = TYPE_LABELS[propertyType];
  const typePhrase = typeLabel ? `${typeLabel} listings` : "listings";
  containerEl.innerHTML = `<div class="listings-loading">Loading live ${escapeHtml(typePhrase)} for ${cityEsc}…</div>`;

  try {
    const listings = await fetchListings(city, propertyType, 0);

    if (listings.length === 0) {
      containerEl.innerHTML = `<div class="listings-empty">No active ${escapeHtml(typePhrase)} found in ${cityEsc} right now. Check back soon.</div>`;
      return;
    }

    containerEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "listings-grid";
    for (const listing of listings) {
      grid.appendChild(renderListingCard(listing));
    }
    containerEl.appendChild(grid);

    // Track pagination state on the container itself so loadMoreListings()
    // can pick up where this left off.
    containerEl._hpListingsState = { city, propertyType, offset: 0, grid };

    if (listings.length === PAGE_LIMIT) {
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

    // Trademark statement -- required on every page displaying DDF content
    // (CREA DDF Policy and Rules, section 6). Placed once per rendered
    // listings section, not per-card.
    const trademark = document.createElement("div");
    trademark.className = "listings-trademark";
    // Exact CREA/REALTOR.ca trademark wording, not a paraphrase (per
    // copyright/trademark accuracy -- confirmed against real REALTOR.ca
    // site footer text, 2026-07-22).
    trademark.innerHTML =
      "The MLS® mark and associated logos identify professional services rendered by REALTOR® members of CREA to effect the purchase, sale and lease of real estate as part of a cooperative selling system.<br>" +
      "The trademarks REALTOR®, REALTORS® and the REALTOR® logo are controlled by CREA and identify real estate professionals who are members of CREA.";
    containerEl.appendChild(trademark);
  } catch (err) {
    containerEl.innerHTML = `<div class="listings-error">Couldn't load live listings right now. Please try again shortly.</div>`;
  }
}

// Exposed for render.js to call.
window.renderLiveListings = renderLiveListings;

// Called by the "View Available Homes" button in render.js /
// render-support.js. Finds the sibling .live-listings-container, toggles
// it open/closed, and lazy-loads listings the first time it's opened for a
// given propertyType (not on every toggle, to avoid re-fetching and
// re-firing view-tracking events on repeat clicks). Re-fetches only when
// propertyType actually changed since the last load for this container --
// e.g. buyer expands "Condo", closes it, then expands "Townhouse" on the
// same city card; those are different result sets, not a repeat click.
function toggleLiveListings(buttonEl, city, propertyType) {
  const container = buttonEl.nextElementSibling;
  if (!container || !container.classList.contains("live-listings-container")) return;

  const isOpen = container.style.display !== "none";
  if (isOpen) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  if (container.dataset.loadedType !== propertyType) {
    container.dataset.loadedType = propertyType;
    renderLiveListings(city, container, propertyType);
  }
}

window.toggleLiveListings = toggleLiveListings;
