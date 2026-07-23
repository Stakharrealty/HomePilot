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

async function fetchListings(city, limit = 12) {
  const url = `${LISTINGS_API_BASE}/listings?city=${encodeURIComponent(city)}&limit=${limit}`;
  const resp = await fetch(url);
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

// --- Public entry point ---
// Renders live DDF listings for a city into the given container element.
// Called from render.js alongside (not replacing) the existing INCOM
// "View Available Homes" button.
async function renderLiveListings(city, containerEl) {
  const cityEsc = escapeHtml(city);
  containerEl.innerHTML = `<div class="listings-loading">Loading live listings for ${cityEsc}…</div>`;

  try {
    const listings = await fetchListings(city);

    if (listings.length === 0) {
      containerEl.innerHTML = `<div class="listings-empty">No active listings found in ${cityEsc} right now. Check back soon.</div>`;
      return;
    }

    containerEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "listings-grid";
    for (const listing of listings) {
      grid.appendChild(renderListingCard(listing));
    }
    containerEl.appendChild(grid);

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

// Called by the "View Live Listings (BETA)" button in render.js. Finds the
// sibling .live-listings-container, toggles it open/closed, and lazy-loads
// listings the first time it's opened (not on every toggle, to avoid
// re-fetching and re-firing view-tracking events on repeat clicks).
function toggleLiveListings(buttonEl, city) {
  const container = buttonEl.nextElementSibling;
  if (!container || !container.classList.contains("live-listings-container")) return;

  const isOpen = container.style.display !== "none";
  if (isOpen) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  if (!container.dataset.loaded) {
    container.dataset.loaded = "true";
    renderLiveListings(city, container);
  }
}

window.toggleLiveListings = toggleLiveListings;
