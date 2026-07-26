// HomePilot — DDF listing display (src/listings-display.js)
// Added 2026-07-22. Renders real CREA/DDF listings pulled from the
// homepilot-listings Worker's D1 database, via GET /listings?city=X.
//
// INCOM WAS FULLY REMOVED 2026-07-22 (see utils.js). This is the only
// listings experience in the app -- and as of 2026-07-25, it's no longer
// an inline expand panel under each city card either (see
// openListingsWindow() below and listings.html): "View Available Homes"
// buttons now open a dedicated separate listings page/popup, per explicit
// product direction that listings should support HomePilot's
// recommendation, not become a browsing experience embedded in it.
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
  const listingUrl = safeUrl(listing.listingUrl) || "";

  // displayAddress is already consent-gated server-side (see
  // consentGatedAddress() in db.js) -- truthy here means CREA explicitly
  // confirmed the seller allowed it to be shown. Never fall back to
  // postalCode or anything else if it's absent; absent means "don't show
  // an address for this listing", not "show what we have instead".
  const addressEsc = listing.displayAddress ? escapeHtml(listing.displayAddress) : null;

  const remarksEsc = listing.publicRemarks ? escapeHtml(listing.publicRemarks) : null;
  const REMARKS_PREVIEW_LEN = 160;
  const remarksIsLong = remarksEsc && remarksEsc.length > REMARKS_PREVIEW_LEN;
  const remarksPreview = remarksEsc ? remarksEsc.slice(0, REMARKS_PREVIEW_LEN) + (remarksIsLong ? "…" : "") : null;

  const detailFacts = [];
  if (listing.yearBuilt) detailFacts.push(`Built ${escapeHtml(String(listing.yearBuilt))}`);
  if (listing.lotSizeArea) {
    const unit = listing.lotSizeUnits ? escapeHtml(String(listing.lotSizeUnits)) : "";
    detailFacts.push(`Lot ${escapeHtml(String(listing.lotSizeArea))}${unit ? " " + unit : ""}`);
  }

  const hasExpandableDetail = !!(remarksEsc || detailFacts.length);

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
      ${addressEsc ? `<div class="listing-address">${addressEsc}</div>` : ""}
      ${bedsBaths ? `<div class="listing-meta">${bedsBaths}</div>` : ""}
      <div class="listing-brokerage">Listed by ${brokerage}</div>
      ${hasExpandableDetail ? `
      <button type="button" class="listing-details-toggle" aria-expanded="false">
        <span>View details</span><span class="listing-details-toggle-arrow">›</span>
      </button>
      <div class="listing-details-panel" hidden>
        ${detailFacts.length ? `<div class="listing-detail-facts">${detailFacts.join(" · ")}</div>` : ""}
        ${remarksEsc ? `<div class="listing-remarks" data-full="${remarksEsc.replace(/"/g, "&quot;")}" data-preview="${(remarksPreview || "").replace(/"/g, "&quot;")}">${remarksPreview}${remarksIsLong ? ` <button type="button" class="listing-remarks-more">Read more</button>` : ""}</div>` : ""}
      </div>` : ""}
      <a class="listing-realtor-badge" href="${listingUrl || "#"}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="View this listing's official page on REALTOR.ca">
        <img class="listing-realtor-badge-logo" src="src/assets/realtor-r.svg" alt="REALTOR® logo" width="14" height="16">
        <span class="listing-realtor-badge-mark">Powered by REALTOR.ca</span>
      </a>
    </div>
  `;

  if (hasExpandableDetail) {
    const toggle = card.querySelector(".listing-details-toggle");
    const panel = card.querySelector(".listing-details-panel");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isOpen));
      panel.hidden = isOpen;
      toggle.querySelector("span:last-child").textContent = isOpen ? "›" : "‹";
      toggle.querySelector("span:first-child").textContent = isOpen ? "View details" : "Hide details";
    });
    const moreBtn = card.querySelector(".listing-remarks-more");
    if (moreBtn) {
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const remarksEl = card.querySelector(".listing-remarks");
        const isExpanded = moreBtn.textContent === "Show less";
        remarksEl.firstChild.textContent = isExpanded ? remarksEl.dataset.preview : remarksEl.dataset.full;
        moreBtn.textContent = isExpanded ? "Read more" : "Show less";
      });
    }
  }

  observeForViewTracking(card, listing.listingKey);
  return card;
}

const TYPE_LABELS_PLURAL = { condo: "Condos", town: "Townhomes", semi: "Semi-Detached Homes", detached: "Detached Homes", all: "Homes" };
const TYPE_LABELS_LOWER = { condo: "condo", town: "townhouse", semi: "semi-detached", detached: "detached home" };

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
async function renderLiveListings(city, containerEl, propertyType) {
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
  containerEl.innerHTML = `${headerHtml}<div class="listings-loading">Loading live ${escapeHtml(loadingPhrase)} for ${cityEsc}…</div>`;

  try {
    const listings = await fetchListings(city, propertyType, 0);

    if (listings.length === 0) {
      containerEl.innerHTML = `${headerHtml}<div class="listings-empty">No active ${escapeHtml(loadingPhrase)} found in ${cityEsc} right now. Check back soon.</div>`;
      return;
    }

    containerEl.innerHTML = headerHtml;
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
    // listings section, not per-card. This requirement is a hard
    // compliance constraint, not a design choice -- it must be carried
    // over exactly regardless of the surrounding page architecture.
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
    containerEl.innerHTML = `${headerHtml}<div class="listings-error">Couldn't load live listings right now. Please try again shortly.</div>`;
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
function openListingsWindow(city, propertyType) {
  const params = new URLSearchParams({ city, type: propertyType || "all" });
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
