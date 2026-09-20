// Stored PropTx fields exposed end to end: getListingsByCity SELECT + row
// mapping (fake D1, no network), the factOrOmit / moneyFactOrEstimate
// helpers, and real card rendering (jsdom over the local static server on
// :8843, mocked fetch) for full, bare-minimum and condo listings.
const path = require("path");
const { pathToFileURL } = require("url");
const { JSDOM, VirtualConsole } = require("jsdom");
const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}

const NEW_COLS = ["parking_spaces", "tax_annual_amount", "tax_year", "association_fee", "association_fee_frequency",
  "garage_type", "basement", "cooling", "heat_type", "virtual_tour_url"];

(async () => {
  // ---------- 1. db.js: SELECT + mapping ----------
  const db = await import(pathToFileURL(path.join(SRC, "db.js")).href);
  let capturedSql = "";
  const row = {
    listing_key: "K1", list_price: 700000, city: "Mississauga", postal_code: "L5B1A1", bedrooms: 3, bathrooms: 2,
    parking_total: 2, parking_spaces: 1, listing_url: "", brokerage_name: "B", photos: "[]", last_updated: "2026-09-19",
    public_remarks: "r", display_address: "1 Main St", year_built: 2001, lot_size_area: 30, lot_size_units: "Feet",
    tax_annual_amount: 4200.5, tax_year: 2025, association_fee: 512, association_fee_frequency: "Monthly",
    garage_type: "Attached", basement: "Finished", cooling: "Central Air", heat_type: "Forced Air", virtual_tour_url: "https://tour.example.com/1",
    latitude: 43.59, longitude: -79.64, derived_property_type: "condo",
  };
  const fakeD1 = { prepare(sql) { capturedSql = sql; return { bind() { return { all: async () => ({ results: [row] }) }; } }; } };
  const [m] = await db.getListingsByCity(fakeD1, "Mississauga", 20, null, 0, null);
  check("SELECT includes every newly exposed column", NEW_COLS.every((c) => new RegExp("\\b" + c + "\\b").test(capturedSql.split("FROM listings")[0])), capturedSql);
  check("mapped camelCase keys carry the stored values",
    m.taxAnnualAmount === 4200.5 && m.taxYear === 2025 && m.associationFee === 512 && m.associationFeeFrequency === "Monthly" &&
    m.garageType === "Attached" && m.basement === "Finished" && m.cooling === "Central Air" &&
    m.virtualTourUrl === "https://tour.example.com/1" && m.parkingSpaces === 1 && m.heatType === "Forced Air");
  check("latitude/longitude are NOT returned (held back until a map + address consent exist)",
    !("latitude" in m) && !("longitude" in m) && !/latitude|longitude/.test(capturedSql));
  check("existing fields still mapped (parkingTotal, propertyType)", m.parkingTotal === 2 && m.propertyType === "condo");
  const bareRow = { listing_key: "K2", list_price: 1, photos: null };
  const bareD1 = { prepare() { return { bind() { return { all: async () => ({ results: [bareRow] }) }; } }; } };
  const [b] = await db.getListingsByCity(bareD1, "Mississauga", 20, null, 0, null);
  check("missing columns come through as undefined/null, not invented values", b.taxAnnualAmount == null && b.garageType == null && b.virtualTourUrl == null);

  // ---------- 2. frontend ----------
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;
  const fact = win.eval("factOrOmit"), money = win.eval("moneyFactOrEstimate");
  check("helpers exist as globals", typeof fact === "function" && typeof money === "function");

  // factOrOmit
  check("factOrOmit: value present", fact("Garage", "Attached") === "Garage: Attached");
  check("factOrOmit: zero is a real value", fact("Parking spaces", 0) === "Parking spaces: 0");
  check("factOrOmit: null / undefined / '' / whitespace -> null",
    fact("Garage", null) === null && fact("Garage", undefined) === null && fact("Garage", "") === null && fact("Garage", "   ") === null);
  check("factOrOmit: escapes HTML", !fact("Basement", "<img src=x onerror=alert(1)>").includes("<img"));
  // moneyFactOrEstimate
  const fmt = (v) => "$" + v;
  check("money: real value, plain label", money("Property tax", 4200, 3000, fmt) === "Property tax: $4200");
  check("money: missing real -> estimate labelled (estimated)", money("Property tax", null, 3000, fmt) === "Property tax (estimated): $3000");
  check("money: zero / non-numeric real treated as missing", money("Condo fee", 0, 400, fmt) === "Condo fee (estimated): $400" && money("Condo fee", "abc", 400, fmt) === "Condo fee (estimated): $400");
  check("money: neither -> null", money("Property tax", null, null, fmt) === null && money("Property tax", undefined, undefined, fmt) === null);
  check("money: output is escaped", !money("Fee", 1, null, () => "<b>x</b>").includes("<b>"));

  // card rendering: the expandable panel is gone (2026-09 card redesign) -- garage,
  // basement, cooling, tax, fee, tour and description live only on listing.html.
  // The full-page rendering of these facts is covered by listing_full_page_test.js.
  const FULL = { listingKey: "FULL", listPrice: 700000, city: "Mississauga", brokerageName: "B", photos: [], propertyType: "detached",
    garageType: "Attached", basement: "Finished", cooling: "Central Air", parkingSpaces: 2, taxAnnualAmount: 4200, taxYear: 2025,
    associationFee: 300, associationFeeFrequency: "Monthly", virtualTourUrl: "https://tour.example.com/1", publicRemarks: "Nice remarks" };
  const el = win.renderListingCard(FULL);
  check("card has no details toggle, panel, remarks or virtual-tour link",
    !el.querySelector(".listing-details-toggle, .listing-details-panel, .listing-remarks, .listing-detail-facts, .listing-virtual-tour"), el.innerHTML);
  check("card no longer shows garage / basement / cooling / parking / tax / fee / remarks text",
    !/Garage|Basement|Cooling|Parking spaces|Property tax|Condo fee|Virtual tour|Nice remarks/.test(el.textContent), el.textContent);

  check("no script errors while loading page", errors.length === 0, errors.join(" | "));
  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
