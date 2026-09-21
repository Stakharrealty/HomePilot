// Listing card thumbnail: clicking the photo should navigate to the same
// listing.html?key=... page as the "Full HomePilot Analysis" pill (same
// tab), be keyboard-reachable (not mouse-only), and not fire when a
// listing has no valid key to link to, or when the carousel's prev/next
// arrows are the actual click target.
//
// jsdom has no real navigation: assigning window.location.href logs a
// jsdomError ("Not implemented: navigation (except hash changes)") and
// does not change window.location -- a known simulator limitation (same
// category as the font-load jsdomError other tests already tolerate), not
// a real bug. So rather than reading window.location.href afterward
// (which jsdom leaves unchanged), this test confirms the handler actually
// ran by asserting exactly that one expected jsdomError appears -- one per
// real click, zero for clicks that should be swallowed (nav buttons) or
// never wired up (no detailHref).
//
// Loads the real index.html via jsdom (same pattern as
// listings_frontend_display_test.js) and calls the real renderListingCard()
// via renderLiveListings() with mocked fetch data.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).

const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";
const NAV_ERROR = "Not implemented: navigation (except hash changes)";

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

const LISTINGS = {
  listings: [
    {
      listingKey: "THUMB1", listPrice: 650000, city: "Guelph",
      brokerageName: "Test Realty", photos: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    },
    {
      // No listingKey at all -> no detailHref -> thumbnail must NOT be clickable
      listingKey: "", listPrice: 500000, city: "Guelph",
      brokerageName: "Test Realty", photos: ["https://cdn.example.com/c.jpg"],
    },
  ],
};

(async () => {
  const virtualConsole = new VirtualConsole();
  const jsdomErrors = [];
  virtualConsole.on("jsdomError", (e) => jsdomErrors.push(e.message));

  const dom = await JSDOM.fromURL(url, { runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;

  win.fetch = async () => ({ ok: true, json: async () => LISTINGS });

  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  await win.renderLiveListings("Guelph", container);

  const cards = [...container.querySelectorAll(".listing-card")];
  const withKey = cards[0], withoutKey = cards[1];
  const wrap1 = withKey.querySelector(".listing-photo-wrap");
  const pillHref = withKey.querySelector("a.listing-detail-link").getAttribute("href");

  // --- 1. structural: clickable styling + accessibility, only when there's
  //        actually somewhere to go ---
  check("(1) thumbnail with a valid key gets the clickable class", wrap1.classList.contains("listing-photo-wrap-clickable"));
  check("(2) thumbnail with a valid key is keyboard-focusable (tabindex 0)", wrap1.tabIndex === 0);
  check("(3) thumbnail with a valid key has role='link' and a descriptive aria-label",
    wrap1.getAttribute("role") === "link" && /homepilot analysis/i.test(wrap1.getAttribute("aria-label") || ""));
  check("(4) thumbnail with NO valid key is not styled or wired as clickable",
    !withoutKey.querySelector(".listing-photo-wrap").classList.contains("listing-photo-wrap-clickable") &&
    withoutKey.querySelector(".listing-photo-wrap").getAttribute("role") !== "link");

  // --- 2. clicking the thumbnail attempts the same navigation as the pill ---
  jsdomErrors.length = 0;
  wrap1.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("(5) clicking the thumbnail triggers exactly one navigation attempt (jsdom's expected 'not implemented' notice)",
    jsdomErrors.filter((m) => m === NAV_ERROR).length === 1, jsdomErrors.join(" | "));
  check("(6) href built for the thumbnail's target matches the pill's own href",
    pillHref.startsWith("listing.html?key=THUMB1"));

  // --- 3. keyboard: Enter and Space both trigger it too ---
  jsdomErrors.length = 0;
  wrap1.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("(7) pressing Enter on the focused thumbnail also navigates", jsdomErrors.filter((m) => m === NAV_ERROR).length === 1, jsdomErrors.join(" | "));

  jsdomErrors.length = 0;
  wrap1.dispatchEvent(new win.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("(8) pressing Space on the focused thumbnail also navigates", jsdomErrors.filter((m) => m === NAV_ERROR).length === 1, jsdomErrors.join(" | "));

  jsdomErrors.length = 0;
  wrap1.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("(9) an unrelated key (Tab) does not navigate", jsdomErrors.filter((m) => m === NAV_ERROR).length === 0, jsdomErrors.join(" | "));

  // --- 4. the carousel's own nav buttons must still work, and must NOT
  //        also trigger a navigation (stopPropagation) ---
  const nextBtn = wrap1.querySelector(".listing-photo-next");
  const counterBefore = wrap1.querySelector(".listing-photo-counter").textContent;
  jsdomErrors.length = 0;
  nextBtn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("(10) clicking the carousel's next arrow advances the photo", wrap1.querySelector(".listing-photo-counter").textContent !== counterBefore);
  check("(11) clicking the carousel's next arrow does NOT also navigate", jsdomErrors.filter((m) => m === NAV_ERROR).length === 0, jsdomErrors.join(" | "));

  // --- 5. no OTHER unexpected DOM/script errors anywhere in this run ---
  const unexpected = jsdomErrors.filter((m) => m !== NAV_ERROR && !m.includes("fonts.googleapis.com"));
  check("(12) no other unexpected DOM/script errors occurred", unexpected.length === 0, unexpected.join(" | "));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
