// Phase 6 (DDF) — frontend listing display test.
//
// Loads the real index.html via jsdom (same pattern as
// browser_load_verification.js and smoke_test.js), then exercises the real
// renderLiveListings()/renderListingCard() functions with mocked fetch data
// (never calls the real homepilot-listings Worker or CREA analytics) to
// confirm the actual rendered DOM satisfies CREA's display requirements:
// price shown, brokerage name shown, "Powered by REALTOR.ca" badge present
// and links to the real listing, and the required trademark statement is
// present on the page once listings render.
//
// Requires: node tests/browser_load_verification.js pattern -- a local
// static server on :8843 must be running (npx http-server -p 8843 -s).

const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";
const errors = [];

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

const FAKE_LISTINGS = {
  city: "Guelph",
  count: 2,
  listings: [
    {
      listingKey: "TEST111",
      listPrice: 725000,
      city: "Guelph",
      bedrooms: 3,
      bathrooms: 2,
      listingUrl: "https://www.realtor.ca/real-estate/TEST111",
      brokerageName: "RE/MAX Realty Specialists",
      photos: ["https://cdn.example.com/photo-a.jpg"],
    },
    {
      listingKey: "TEST222",
      listPrice: 899000,
      city: "Guelph",
      bedrooms: 4,
      bathrooms: 3,
      listingUrl: "https://www.realtor.ca/real-estate/TEST222",
      brokerageName: null, // no brokerage on file -- must not crash
      photos: [],
    },
  ],
};

// Bug fix 2026-07-23: brokerageName, city, and listingUrl/photo URLs come
// straight from CREA's DDF feed and were being inserted into innerHTML
// unescaped. Two listings here, split deliberately:
//   - XSS-CITY: has a VALID https photo, so the city value actually gets
//     rendered (it only ever appears in the photo's alt attribute -- with
//     no photo, city is never referenced at all, so this needs a real
//     photo to exercise the code path).
//   - XSS-BROKER-URL: malicious brokerageName + javascript: listingUrl +
//     javascript: photo, to prove those are neutralized independently.
const XSS_LISTINGS = {
  city: "Guelph",
  count: 2,
  listings: [
    {
      listingKey: "XSS-CITY",
      listPrice: 500000,
      city: "<img src=x onerror=alert(1)>",
      bedrooms: 3,
      bathrooms: 2,
      listingUrl: "https://www.realtor.ca/real-estate/XSS-CITY",
      brokerageName: "Safe Realty",
      photos: ["https://cdn.example.com/xss-photo.jpg"],
    },
    {
      listingKey: "XSS-BROKER-URL",
      listPrice: 500000,
      city: "Guelph",
      bedrooms: 3,
      bathrooms: 2,
      listingUrl: "javascript:alert(document.cookie)",
      brokerageName: "<script>alert('brokerage')</script>",
      photos: ["javascript:alert(1)"],
    },
  ],
};

(async () => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  virtualConsole.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(url, {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole,
    pretendToBeVisual: true,
  });

  await new Promise((res) => setTimeout(res, 1500));
  const win = dom.window;

  // --- 1. Functions exist as real globals (script-tag style, not modules --
  //     function declarations attach to window automatically) ---
  check("window.renderLiveListings exists", typeof win.renderLiveListings === "function");
  check("window.toggleLiveListings exists", typeof win.toggleLiveListings === "function");

  // --- 2. Mock fetch, then actually call renderLiveListings with fake data
  //     and inspect the real rendered DOM -- never touches the real
  //     homepilot-listings Worker or CREA's analytics endpoint ---
  const analyticsCallsSeen = [];
  win.fetch = async (fetchUrl) => {
    if (String(fetchUrl).includes("/listings")) {
      return { ok: true, json: async () => FAKE_LISTINGS };
    }
    if (String(fetchUrl).includes("analytics.crea.ca")) {
      analyticsCallsSeen.push(String(fetchUrl));
      return { ok: true, json: async () => ({}) };
    }
    throw new Error("Unexpected fetch in test: " + fetchUrl);
  };
  // sendBeacon isn't in jsdom -- stub it so the analytics fire-and-forget
  // path doesn't throw, and so we can verify it's actually being called
  win.navigator.sendBeacon = (beaconUrl) => {
    analyticsCallsSeen.push(String(beaconUrl));
    return true;
  };

  const container = win.document.createElement("div");
  win.document.body.appendChild(container);

  await win.renderLiveListings("Guelph", container);

  const cards = container.querySelectorAll(".listing-card");
  check("renders exactly 2 listing cards from fake data", cards.length === 2, `found ${cards.length}`);

  const html = container.innerHTML;

  // --- 3. Compliance checks on the ACTUAL rendered output ---
  check("rendered price is formatted as real currency ($725,000)", html.includes("$725,000"));
  check("rendered brokerage name is shown in visible text (RE/MAX Realty Specialists)", html.includes("RE/MAX Realty Specialists"));
  check(
    "listing with no brokerage name on file doesn't crash, shows a fallback instead",
    html.includes("Brokerage not available")
  );
  check("'Powered by REALTOR.ca' badge text is present", html.includes("Powered by REALTOR.ca"));
  check(
    "real REALTOR® logo image is referenced (not a text-only placeholder)",
    html.includes("src/assets/realtor-r.svg")
  );
  check(
    "REALTOR.ca badge links to the real listing URL, not a placeholder",
    html.includes('href="https://www.realtor.ca/real-estate/TEST111"')
  );
  check(
    "listing with a photo renders an <img> with the real photo URL",
    html.includes('src="https://cdn.example.com/photo-a.jpg"')
  );
  check(
    "listing with NO photo shows a fallback, not a broken image",
    html.includes("No photo available")
  );
  check(
    "required MLS/CREA trademark statement is present on the page",
    html.includes("MLS") && html.includes("CREA")
  );

  // --- 3b. XSS: malicious CREA-shaped payloads must be neutralized, not
  //     rendered as live markup/script/links (bug fix 2026-07-23).
  //     Checked via real DOM APIs (element counts, attribute/textContent
  //     values as the browser actually parsed them) rather than exact
  //     string matching -- browsers don't necessarily round-trip escaped
  //     quotes/apostrophes the same way on serialization, but what
  //     actually matters for security is that no extra element, script,
  //     or executable attribute got created. ---
  win.fetch = async (fetchUrl) => {
    if (String(fetchUrl).includes("/listings")) {
      return { ok: true, json: async () => XSS_LISTINGS };
    }
    return { ok: true, json: async () => ({}) };
  };
  const xssContainer = win.document.createElement("div");
  win.document.body.appendChild(xssContainer);
  await win.renderLiveListings("Guelph", xssContainer);

  const cityCard = xssContainer.querySelector('img.listing-photo');
  check(
    "malicious city value lands as inert alt text, not a live extra <img> element",
    !!cityCard && cityCard.alt === "Photo of listing in <img src=x onerror=alert(1)>",
    `alt="${cityCard && cityCard.alt}"`
  );
  check(
    "no attacker-controlled onerror attribute got attached to any real element",
    xssContainer.querySelectorAll("[onerror]").length === 0
  );
  check(
    "exactly the expected number of real <img> elements exist (no injected extra one from the city payload)",
    xssContainer.querySelectorAll("img").length === 3, // card1: photo img + logo img; card2: logo img only (its photo URL was rejected)
    `found ${xssContainer.querySelectorAll("img").length}`
  );

  const brokerEls = [...xssContainer.querySelectorAll(".listing-brokerage")];
  const maliciousBrokerEl = brokerEls.find((el) => el.textContent.includes("alert"));
  check(
    "malicious brokerageName lands as inert text content, not a live <script> element",
    !!maliciousBrokerEl && maliciousBrokerEl.textContent === "Listed by <script>alert('brokerage')</script>",
    `textContent="${maliciousBrokerEl && maliciousBrokerEl.textContent}"`
  );
  check(
    "no live <script> element was created anywhere in the rendered output",
    xssContainer.querySelectorAll("script").length === 0
  );

  const xssCards = [...xssContainer.querySelectorAll(".listing-card")];
  const brokerUrlCard = xssCards[1];
  const realtorLink = brokerUrlCard ? brokerUrlCard.querySelector("a.listing-realtor-badge") : null;
  check(
    "badge link's real href attribute is not a javascript: URL (checked via DOM property, not string match)",
    !!realtorLink && !String(realtorLink.getAttribute("href")).toLowerCase().startsWith("javascript:"),
    `href="${realtorLink && realtorLink.getAttribute("href")}"`
  );
  check(
    "listing with a javascript: photo URL falls back to the no-photo state instead of rendering it",
    !!brokerUrlCard && brokerUrlCard.querySelector(".listing-photo-empty") !== null
  );
  check(
    "javascript: photo URL was never used as any <img> src on that card",
    !!brokerUrlCard && brokerUrlCard.querySelectorAll('img[src^="javascript:"]').length === 0
  );

  // --- 4. Empty-results and error-path behavior (not just the happy path) ---
  win.fetch = async () => ({ ok: true, json: async () => ({ listings: [] }) });
  const emptyContainer = win.document.createElement("div");
  win.document.body.appendChild(emptyContainer);
  await win.renderLiveListings("Ottawa", emptyContainer);
  check(
    "zero listings shows a clear empty-state message, not a blank/broken container",
    emptyContainer.innerHTML.toLowerCase().includes("no active listings")
  );

  win.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const errorContainer = win.document.createElement("div");
  win.document.body.appendChild(errorContainer);
  await win.renderLiveListings("Barrie", errorContainer);
  check(
    "a failed fetch shows an error message, not a silent blank container",
    errorContainer.innerHTML.toLowerCase().includes("couldn't load")
  );

  check("no uncaught DOM/script errors occurred during any of this", errors.length === 0, errors.join("; "));

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error("Fatal error during test:", e);
  process.exit(1);
});
