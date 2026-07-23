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
