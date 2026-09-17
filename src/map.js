// map.js — HomePilot base map (Phase 1: map only)
//
// Scope of this module is deliberately tiny: render a single Google Map inside
// the existing results experience. No markers, no listings, no commute, no
// Routes, no Places, no ranking input. Nothing in this file reads or writes
// affordability, ranking, or listing state.
//
// Design notes:
//  - Fully additive. No existing module calls into this one and this one calls
//    into no existing module. If it fails, it hides itself and the rest of the
//    results page is unaffected.
//  - The Maps JS library is loaded lazily, only once the map container actually
//    scrolls into view, so a user who never reaches the results section never
//    pays for a Maps JS load (billed per map load).
//  - The API key is NOT stored in this file or anywhere in the repository. It is
//    read from window.HOMEPILOT_MAPS_KEY, which is supplied at deploy time by a
//    generated, git-ignored src/maps-key.js. See src/maps-key.example.js.

(function () {
  'use strict';

  var CONTAINER_ID = 'hpMap';
  var loading = false;
  var loaded = false;

  // Ontario view centred between the GTA and the Dufferin/Caledon corridor.
  var DEFAULT_CENTER = { lat: 43.85, lng: -79.70 };
  var DEFAULT_ZOOM = 8;

  function getKey() {
    return (typeof window.HOMEPILOT_MAPS_KEY === 'string' && window.HOMEPILOT_MAPS_KEY.trim())
      ? window.HOMEPILOT_MAPS_KEY.trim()
      : '';
  }

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  // Called by the Maps JS loader callback once the library is on the page.
  function initMap() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el || !window.google || !window.google.maps) return;
    try {
      new window.google.maps.Map(el, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'cooperative'
      });
      el.removeAttribute('data-map-state');
      el.setAttribute('data-map-state', 'ready');
    } catch (e) {
      // Never let a map failure surface as a broken results page.
      hide(el.parentNode && el.parentNode.id === 'hpMapWrap' ? el.parentNode : el);
    }
  }
  window.hpInitMap = initMap;

  function loadMapsLibrary() {
    if (loading || loaded) return;
    var key = getKey();
    var el = document.getElementById(CONTAINER_ID);
    if (!key) {
      // No key configured (e.g. local dev, or a preview build) — hide the
      // placeholder entirely rather than showing Google's "for development
      // purposes only" watermark to a buyer.
      hide(document.getElementById('hpMapWrap'));
      return;
    }
    loading = true;
    var s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' +
            encodeURIComponent(key) + '&callback=hpInitMap&loading=async&v=weekly';
    s.async = true;
    s.onload = function () { loaded = true; };
    s.onerror = function () {
      loading = false;
      hide(document.getElementById('hpMapWrap'));
    };
    document.head.appendChild(s);
    if (el) el.setAttribute('data-map-state', 'loading');
  }

  function watch() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    if (!('IntersectionObserver' in window)) { loadMapsLibrary(); return; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); loadMapsLibrary(); return; }
      }
    }, { rootMargin: '200px' });
    io.observe(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
})();
