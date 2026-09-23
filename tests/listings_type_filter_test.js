// Property-type filter pills on the listings page.
//
// listings.html landed on a fixed property type (from the recommendation
// card that opened it) with no way to change it. This adds an "All /
// Condos / Townhomes / Semi-Detached / Detached" pill row -- the same look
// and options as the calculator's own "Property Type" filter
// (calculator.html: #pt-all/condo/town/semi/detached, filtProp()) -- right
// under the page header, that re-fetches listings for the picked type.
//
// Loads the real index.html via jsdom (same pattern as
// listings_frontend_display_test.js) and exercises the real
// renderLiveListings() with mocked fetch data -- never touches the real
// homepilot-listings Worker.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).

const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

const LISTINGS_BY_TYPE = {
  all: [{ listingKey: "A1", listPrice: 725000, city: "Guelph", brokerageName: "Test Realty", photos: [] }],
  condo: [{ listingKey: "C1", listPrice: 499000, city: "Guelph", brokerageName: "Test Realty", photos: [] }],
  detached: [], // deliberately empty: exercises the empty-state branch
};

(async () => {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));

  const dom = await JSDOM.fromURL(url, { runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;

  const calls = [];
  let fetchMode = "byType"; // switched to "reject" to exercise the error branch
  win.fetch = async (fetchUrl) => {
    calls.push(String(fetchUrl));
    if (fetchMode === "reject") throw new Error("network down");
    const u = new URL(String(fetchUrl));
    const type = u.searchParams.get("type") || "all";
    return { ok: true, json: async () => ({ listings: LISTINGS_BY_TYPE[type] || [] }) };
  };

  const container = win.document.createElement("div");
  win.document.body.appendChild(container);

  // =============== 1. renders with the default type active ===============
  const renderPromise = win.renderLiveListings("Guelph", container, "all", undefined);
  // State must exist synchronously, before the fetch resolves -- a pill
  // clicked during the very first load still needs city/searchBudget.
  check("(A1) container state is set synchronously, before the fetch resolves",
    !!container._hpListingsState && container._hpListingsState.city === "Guelph");
  await renderPromise;

  const bar = () => container.querySelector(".filter-group");
  const pills = () => [...container.querySelectorAll(".filter-group .filters .fb")];
  check("(A2) filter bar renders with a 'Property Type' label", !!bar() && bar().querySelector(".filter-label").textContent === "Property Type");
  check("(A3) exactly 5 pills, in order: All, Condos, Townhomes, Semi-Detached, Detached",
    pills().map((b) => b.textContent).join(",") === "All,Condos,Townhomes,Semi-Detached,Detached");
  check("(A4) 'All' is the active pill by default", pills()[0].classList.contains("on") && pills().every((b, i) => i === 0 || !b.classList.contains("on")));
  // Order since 2026-09-23: header, property-type pills, then the bedroom/sort
  // row (.listings-refine, its own wrapper so pills() above still sees only the
  // five type pills), then the grid.
  const refine = bar() && bar().nextElementSibling;
  check("(A5) filter bar sits right after the page header, then the bedroom/sort row, then the grid",
    container.querySelector(".listings-page-header").nextElementSibling === bar() &&
    refine && refine.classList.contains("listings-refine") &&
    refine.nextElementSibling && refine.nextElementSibling.classList.contains("listings-grid"));
  check("(A6) title reflects the active type ('Available Homes...', not a specific type)", container.querySelector(".listings-page-title").textContent.startsWith("Available Homes"));

  // =============== 2. clicking a pill re-fetches for that type ===============
  calls.length = 0;
  pills()[1].click(); // "Condos"
  await new Promise((r) => setTimeout(r, 50));
  check("(B1) clicking 'Condos' fetches with type=condo", calls.some((c) => c.includes("type=condo")), calls.join(" | "));
  check("(B2) the new listing (Condos data) is now rendered", container.textContent.includes("$499,000") && !container.textContent.includes("$725,000"));
  check("(B3) 'Condos' is now the active pill, and only that one", pills()[1].classList.contains("on") && pills().filter((b) => b.classList.contains("on")).length === 1);
  check("(B4) title updates to the picked type", container.querySelector(".listings-page-title").textContent.startsWith("Available Condos"));
  check("(B5) URL reflects the picked type (type=condo)", win.location.search.includes("type=condo"));

  // =============== 3. switching back to 'All' clears the type param ===============
  pills()[0].click();
  await new Promise((r) => setTimeout(r, 50));
  check("(C1) back to 'All': fetch has no type param", calls[calls.length - 1] && !calls[calls.length - 1].includes("type="), calls[calls.length - 1]);
  check("(C2) URL no longer has a type param", !win.location.search.includes("type="));

  // =============== 4. empty state still shows the filter bar ===============
  pills()[4].click(); // "Detached" -> configured to return zero listings
  await new Promise((r) => setTimeout(r, 50));
  check("(D1) empty-state message shows", !!container.querySelector(".listings-empty"));
  check("(D2) filter bar is still present and usable in the empty state", !!bar() && pills().length === 5 && pills()[4].classList.contains("on"));

  // Recover from the empty state back to a type with data, so the next
  // section starts from a normal render.
  pills()[0].click();
  await new Promise((r) => setTimeout(r, 50));

  // =============== 5. error state still shows the filter bar ===============
  fetchMode = "reject";
  pills()[1].click();
  await new Promise((r) => setTimeout(r, 50));
  check("(E1) fetch failure shows the error message", !!container.querySelector(".listings-error"));
  check("(E2) filter bar is still present and usable after an error", !!bar() && pills().length === 5);

  // =============== 6. an unrecognized type in the URL defaults to 'All' active ===============
  fetchMode = "byType";
  await win.renderLiveListings("Guelph", container, "bogus-type", undefined);
  check("(F1) unrecognized type: 'All' pill is the one marked active (never none, never a phantom option)",
    pills()[0].classList.contains("on") && pills().filter((b) => b.classList.contains("on")).length === 1);

  check("(G1) no uncaught DOM/script errors occurred during any of this", errors.length === 0, errors.join(" | "));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
