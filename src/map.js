// map.js — HomePilot listings map (Phase 1: base map only)
//
// Lives on listings.html only. The buyer sees listing cards first; the map is
// opt-in behind a "Show map" toggle. Nothing is loaded from Google until they
// actually press it, so a buyer who never opens the map costs nothing.
//
// Scope of this phase is deliberately tiny: show a base map centred on the
// city being viewed. NO listing markers, NO commute layer, NO Routes, NO
// Places. Those come in a later phase once the IDX/DDF marker work is agreed.
//
// This module is fully additive. It does not call into listings-display.js and
// listings-display.js does not call into it. If the key is missing or Google
// fails to load, the toggle removes itself and the listing cards are
// completely unaffected.
//
// The API key is NOT in this file or anywhere in the repository. It is read
// from window.HOMEPILOT_MAPS_KEY, supplied by a generated, git-ignored
// src/maps-key.js. See src/maps-key.example.js.

(function () {
  'use strict';

  var WRAP_ID   = 'hpMapWrap';
  var MAP_ID    = 'hpMap';
  var TOGGLE_ID = 'hpMapToggle';

  var loading = false;
  var ready   = false;
  var open    = false;

  // Fallback view: Ontario, centred between the GTA and the Dufferin/Caledon
  // corridor. Used until we have a per-city centre.
  var DEFAULT_CENTER = { lat: 43.85, lng: -79.70 };
  var DEFAULT_ZOOM   = 8;

  // Centres for the municipalities HomePilot covers, so the map opens on the
  // city the buyer is actually looking at rather than a generic province view.
  // Static data only — no geocoding call, no Places lookup.
  var CITY_CENTERS = {
    'orangeville':   { lat: 43.9190, lng: -80.0940, zoom: 12 },
    'caledon':       { lat: 43.8668, lng: -79.9333, zoom: 11 },
    'bolton':        { lat: 43.8768, lng: -79.7365, zoom: 12 },
    'brampton':      { lat: 43.7315, lng: -79.7624, zoom: 11 },
    'mississauga':   { lat: 43.5890, lng: -79.6441, zoom: 11 },
    'toronto':       { lat: 43.6532, lng: -79.3832, zoom: 11 },
    'shelburne':     { lat: 44.0784, lng: -80.2044, zoom: 12 },
    'mono':          { lat: 43.9834, lng: -80.0330, zoom: 11 },
    'grand valley':  { lat: 43.9000, lng: -80.3167, zoom: 12 },
    'erin':          { lat: 43.7667, lng: -80.0667, zoom: 12 },
    'halton hills':  { lat: 43.6300, lng: -79.9500, zoom: 11 },
    'milton':        { lat: 43.5183, lng: -79.8774, zoom: 11 },
    'guelph':        { lat: 43.5448, lng: -80.2482, zoom: 11 },
    'barrie':        { lat: 44.3894, lng: -79.6903, zoom: 11 },
    'new tecumseth': { lat: 44.0800, lng: -79.7800, zoom: 11 },
    'vaughan':       { lat: 43.8361, lng: -79.4983, zoom: 11 }
  };

  function getKey() {
    return (typeof window.HOMEPILOT_MAPS_KEY === 'string' && window.HOMEPILOT_MAPS_KEY.trim())
      ? window.HOMEPILOT_MAPS_KEY.trim()
      : '';
  }

  // The city currently being viewed, taken from the same query string
  // listings.html already reads. Read-only; nothing here changes it.
  function getView() {
    var city = '';
    try {
      city = (new URLSearchParams(window.location.search).get('city') || '').trim().toLowerCase();
    } catch (e) { /* older browser or malformed query — fall through to default */ }
    var hit = CITY_CENTERS[city];
    if (hit) return { center: { lat: hit.lat, lng: hit.lng }, zoom: hit.zoom };
    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  }

  function removeToggle() {
    var t = document.getElementById(TOGGLE_ID);
    if (t && t.parentNode) t.parentNode.removeChild(t);
    var w = document.getElementById(WRAP_ID);
    if (w) w.style.display = 'none';
  }

  // Called by the Maps JS loader once the library is on the page.
  function initMap() {
    var el = document.getElementById(MAP_ID);
    if (!el || !window.google || !window.google.maps) return;
    try {
      var view = new window.google.maps.Map(el, {
        center: getView().center,
        zoom: getView().zoom,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'cooperative'
      });
      ready = true;
      el.setAttribute('data-map-state', 'ready');
      return view;
    } catch (e) {
      removeToggle();
    }
  }
  window.hpInitMap = initMap;

  function loadMapsLibrary() {
    if (loading || ready) return;
    var key = getKey();
    if (!key) { removeToggle(); return; }
    loading = true;
    var s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' +
            encodeURIComponent(key) + '&callback=hpInitMap&loading=async&v=weekly';
    s.async = true;
    s.onerror = function () { loading = false; removeToggle(); };
    document.head.appendChild(s);
  }

  function setLabel(btn) {
    btn.textContent = open ? '✕ Hide map' : '🗺️ Show map';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function onToggle(btn) {
    var wrap = document.getElementById(WRAP_ID);
    if (!wrap) return;
    open = !open;
    wrap.style.display = open ? 'block' : 'none';
    setLabel(btn);
    // Load Google only on the first open — never on page load.
    if (open) loadMapsLibrary();
  }

  function wire() {
    var btn = document.getElementById(TOGGLE_ID);
    if (!btn) return;
    if (!getKey()) { removeToggle(); return; }
    setLabel(btn);
    btn.addEventListener('click', function () { onToggle(btn); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
