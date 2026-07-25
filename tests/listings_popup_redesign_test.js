// Phase 7 (DDF) — listings redesign test: dedicated popup/page instead of
// inline expand-under-city-card.
//
// Why this exists: per explicit product direction 2026-07-25, listings must
// NOT be embedded inside city cards or expand inline beneath a
// recommendation. "View Available Homes" now opens a dedicated separate
// experience: a real OS popup window on desktop, a real URL navigation
// (native back button, shareable) on mobile. This replaces the old
// toggleLiveListings() inline expand/collapse entirely.
//
// This test does NOT open a real browser window (no jsdom window.open
// support worth relying on). It statically verifies:
//   1. listings.html exists and is self-contained (loads its own copy of
//      the required scripts, doesn't depend on index.html's DOM)
//   2. openListingsWindow() exists, is exposed on window, and calls
//      window.open() SYNCHRONOUSLY (no await/async before it) -- this is
//      the exact popup-blocker constraint that motivated this design; a
//      regression here would silently break the desktop popup for every
//      user with default browser settings, with no visible error.
//   3. render.js / render-support.js call openListingsWindow(city, type),
//      not the removed toggleLiveListings(this, city, type)
//   4. The old inline .live-listings-container divs are gone from the
//      per-city button markup in render.js/render-support.js (listings.html
//      itself still legitimately has one for its own single listings
//      section -- see listings-display.js's loadMoreListings(), which
//      still relies on that class name via .closest())
//   5. The empty/loading copy says plain "listings" when no specific
//      property type is given, not an awkward default word -- regression
//      guard for the exact bug found and fixed this session (see
//      tests/listings_frontend_display_test.js's "no active listings"
//      check for the runtime version of this same check)
//
// Run: node tests/listings_popup_redesign_test.js

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

function main() {
  const listingsHtmlPath = path.join(REPO_ROOT, "listings.html");
  const displaySrc = fs.readFileSync(path.join(REPO_ROOT, "src", "listings-display.js"), "utf8");
  const renderSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "render.js"), "utf8");
  const renderSupportSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "render-support.js"), "utf8");

  // --- 1. listings.html exists and is self-contained ---
  check("listings.html exists", fs.existsSync(listingsHtmlPath));
  const listingsHtml = fs.existsSync(listingsHtmlPath) ? fs.readFileSync(listingsHtmlPath, "utf8") : "";
  check(
    "listings.html loads listings-display.js (its rendering logic)",
    /<script src=["']src\/listings-display\.js["']/.test(listingsHtml)
  );
  check(
    "listings.html loads ai.js (required for escapeHtml, which listings-display.js depends on)",
    /<script src=["']src\/ai\.js["']/.test(listingsHtml)
  );
  check(
    "listings.html reads city and type from its own URL query params (not from a shared app-state global)",
    /new URLSearchParams\(window\.location\.search\)/.test(listingsHtml) &&
    /params\.get\(["']city["']\)/.test(listingsHtml) &&
    /params\.get\(["']type["']\)/.test(listingsHtml)
  );
  check(
    "listings.html has a back/close affordance (mobile back link, desktop popup close)",
    /window\.close\(\)/.test(listingsHtml) && /Back to Recommendations/.test(listingsHtml)
  );

  // --- 2. openListingsWindow() exists and calls window.open() synchronously ---
  check(
    "listings-display.js exports openListingsWindow on window",
    /window\.openListingsWindow\s*=\s*openListingsWindow/.test(displaySrc)
  );
  check(
    "the OLD toggleLiveListings() inline toggle function is gone (fully replaced, not left dead alongside the new one)",
    !/function toggleLiveListings\(/.test(displaySrc)
  );
  {
    // Extract just the openListingsWindow function body to check ordering
    // precisely -- window.open() must be the first real statement, nothing
    // async/awaited before it.
    const fnStart = displaySrc.indexOf("function openListingsWindow(");
    const fnEnd = fnStart === -1 ? -1 : displaySrc.indexOf("\nwindow.openListingsWindow", fnStart);
    const fnBody = fnStart !== -1 && fnEnd !== -1 ? displaySrc.slice(fnStart, fnEnd) : "";
    check("openListingsWindow() function body located for scoping these checks", fnBody.length > 0);
    check(
      "openListingsWindow() is NOT declared async (an async function is itself enough to break the popup-blocker's synchronous-click requirement, even if nothing inside it is awaited)",
      !/async function openListingsWindow/.test(displaySrc)
    );
    check(
      "no 'await' appears anywhere before the window.open( call inside openListingsWindow()",
      (() => {
        const openIdx = fnBody.indexOf("window.open(");
        if (openIdx === -1) return false;
        const before = fnBody.slice(0, openIdx);
        return !/await\s/.test(before);
      })()
    );
    check(
      "window.open() uses a named target (re-focuses/reuses one popup instead of spawning duplicates on repeat clicks)",
      /window\.open\(url,\s*["'][\w-]+["']/.test(fnBody)
    );
    check(
      "window.open() call does NOT include 'noopener' -- noopener makes window.open() ALWAYS return null by design (browser withholds the reference), which silently broke the very next line's `if (popup)` check: every desktop click fell through to the else-branch (same-tab navigation) regardless of whether a popup actually opened. Confirmed live 2026-07-25 with a real mouse click, not just a script-simulated one.",
      (() => {
        const openCallStart = fnBody.indexOf("window.open(url,");
        if (openCallStart === -1) return false;
        const openCallEnd = fnBody.indexOf(")", openCallStart);
        const openCall = fnBody.slice(openCallStart, openCallEnd);
        return !/noopener/.test(openCall);
      })()
    );
    check(
      "mobile path uses real navigation (window.location.href), not an in-app overlay -- gives the native back button and a shareable URL",
      /window\.location\.href\s*=\s*url/.test(fnBody)
    );
  }

  // --- 3. render.js / render-support.js call the new function, not the old one ---
  check(
    "render.js's main city-card button calls openListingsWindow(...), not toggleLiveListings(...)",
    /openListingsWindow\(/.test(renderSrc) && !/toggleLiveListings\(/.test(renderSrc)
  );
  check(
    "render.js's selectPropType() per-type button calls openListingsWindow(cityName,tp)",
    /openListingsWindow\(\\'\+cityName\+\\',\\'\+tp\+\\'\)/.test(renderSrc) ||
    /openListingsWindow\(.*cityName.*tp.*\)/.test(renderSrc)
  );
  // render-support.js's angle-pick button check REMOVED 2026-07-25 (not
  // just silently deleted): the "3 Ways to Look at Your Search" angle-pick
  // cards this button lived in were removed entirely per explicit product
  // decision (frequently redundant with the top of the sorted "All
  // Cities" list below them -- confirmed via live testing). There is no
  // longer any angle-pick button in render-support.js to call
  // openListingsWindow() at all -- toggleLiveListings() is still
  // confirmed absent everywhere via the check below, which is what
  // actually matters for this test file's purpose (the popup redesign).
  check(
    "toggleLiveListings() is not reintroduced anywhere in render-support.js (whether or not an angle-pick button exists)",
    !/toggleLiveListings\(/.test(renderSupportSrc)
  );

  // --- 4. old inline containers removed from the per-city button markup ---
  check(
    "render.js no longer emits a live-listings-container div next to the main view-btn",
    !/class="view-btn"[\s\S]{0,20}live-listings-container/.test(renderSrc)
  );
  check(
    "render-support.js no longer emits a live-listings-container div next to the angle-pick view-btn",
    !/class="view-btn"[\s\S]{0,20}live-listings-container/.test(renderSupportSrc)
  );

  // --- 5. empty/loading copy regression guard ---
  check(
    "listings-display.js's TYPE_LABELS_LOWER has no fallback-word default that would produce awkward phrasing like 'No active home listings' when no specific type is given",
    !/TYPE_LABELS_LOWER\s*=\s*\{[^}]*all:\s*["']home["']/.test(displaySrc)
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
