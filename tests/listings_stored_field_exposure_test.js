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
  "garage_type", "basement", "cooling", "virtual_tour_url", "latitude", "longitude"];

(async () => {
  // ---------- 1. db.js: SELECT + mapping ----------
  const db = await import(pathToFileURL(path.join(SRC, "db.js")).href);
  let capturedSql = "";
  const row = {
    listing_key: "K1", list_price: 700000, city: "Mississauga", postal_code: "L5B1A1", bedrooms: 3, bathrooms: 2,
    parking_total: 2, parking_spaces: 1, listing_url: "", brokerage_name: "B", photos: "[]", last_updated: "2026-09-19",
    public_remarks: "r", display_address: "1 Main St", year_built: 2001, lot_size_area: 30, lot_size_units: "Feet",
    tax_annual_amount: 4200.5, tax_year: 2025, association_fee: 512, association_fee_frequency: "Monthly",
    garage_type: "Attached", basement: "Finished", cooling: "Central Air", virtual_tour_url: "https://tour.example.com/1",
    latitude: 43.59, longitude: -79.64, derived_property_type: "condo",
  };
  const fakeD1 = { prepare(sql) { capturedSql = sql; return { bind() { return { all: async () => ({ results: [row] }) }; } }; } };
  const [m] = await db.getListingsByCity(fakeD1, "Mississauga", 20, null, 0, null);
  check("SELECT includes every newly exposed column", NEW_COLS.every((c) => new RegExp("\\b" + c + "\\b").test(capturedSql.split("FROM listings")[0])), capturedSql);
  check("mapped camelCase keys carry the stored values",
    m.taxAnnualAmount === 4200.5 && m.taxYear === 2025 && m.associationFee === 512 && m.associationFeeFrequency === "Monthly" &&
    m.garageType === "Attached" && m.basement === "Finished" && m.cooling === "Central Air" &&
    m.virtualTourUrl === "https://tour.example.com/1" && m.parkingSpaces === 1 && m.latitude === 43.59 && m.longitude === -79.64);
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

  // card rendering
  const FULL = { listingKey: "FULL", listPrice: 700000, city: "Mississauga", brokerageName: "B", photos: [], propertyType: "detached",
    garageType: "Attached", basement: "Finished", cooling: "Central Air", parkingSpaces: 2, taxAnnualAmount: 4200, taxYear: 2025,
    associationFee: 300, associationFeeFrequency: "Monthly", virtualTourUrl: "https://tour.example.com/1", publicRemarks: "Nice" };
  const BARE = { listingKey: "BARE", listPrice: 500000, city: "Mississauga", brokerageName: "B", photos: [], propertyType: "detached" };
  const CONDO_REAL = { listingKey: "CR", listPrice: 400000, city: "Mississauga", brokerageName: "B", photos: [], propertyType: "condo", associationFee: 612, associationFeeFrequency: "Monthly", publicRemarks: "x" };
  const CONDO_NONE = { listingKey: "CN", listPrice: 400000, city: "Mississauga", brokerageName: "B", photos: [], propertyType: "condo", publicRemarks: "x" };
  const CONDO_EST = { ...CONDO_NONE, listingKey: "CE", estimatedCondoFee: 450, estimatedTaxAnnual: 2500 };
  const BAD_TOUR = { ...FULL, listingKey: "BT", virtualTourUrl: "javascript:alert(1)" };
  const render = (l) => win.renderListingCard(l);
  const panel = (l) => { const el = render(l); const p = el.querySelector(".listing-details-panel"); return { el, text: el.textContent, p, html: el.innerHTML }; };

  const f = panel(FULL);
  check("(a) full listing shows Garage, Basement, Cooling, Parking spaces",
    ["Garage: Attached", "Basement: Finished", "Cooling: Central Air", "Parking spaces: 2"].every((x) => f.text.includes(x)));
  check("(a) full listing shows real property tax with year", f.text.includes("Property tax: $4,200/yr (2025)"), f.text);
  check("(a) non-condo does not show a condo fee", !f.text.includes("Condo fee"));
  check("(a) virtual tour link is present, https, new tab, noopener", !!f.el.querySelector('a.listing-virtual-tour[href="https://tour.example.com/1"][target="_blank"][rel*="noopener"]'));
  check("(a) real tax shown without '(estimated)'", !f.text.includes("(estimated)"));

  const bare = panel(BARE);
  check("(b) bare listing never renders N/A / Not available / undefined / null for the new facts",
    !/N\/A|Not available|undefined|null/i.test(bare.text.replace("Brokerage not available", "")), bare.text);
  check("(b) bare listing has no Garage/Basement/Cooling/Parking/tax/condo fee/tour lines",
    !/Garage|Basement|Cooling|Parking spaces|Property tax|Condo fee|Virtual tour/.test(bare.text));
  check("(b) bare listing has no empty details panel or toggle", !bare.el.querySelector(".listing-details-toggle"));

  const cr = panel(CONDO_REAL);
  check("(c) condo with real fee: 'Condo fee: $612/monthly' with no (estimated)", cr.text.includes("Condo fee: $612/monthly") && !cr.text.includes("Condo fee (estimated)"), cr.text);
  const cn = panel(CONDO_NONE);
  check("(c) condo with no fee and no estimate: no Condo fee line at all", !cn.text.includes("Condo fee"));
  const ce = panel(CONDO_EST);
  check("(c) condo with only an estimate: labelled (estimated), tax too",
    ce.text.includes("Condo fee (estimated): $450/mo") && ce.text.includes("Property tax (estimated): $2,500/yr"), ce.text);

  const bt = panel(BAD_TOUR);
  check("unsafe (javascript:) virtual tour URL is dropped", !bt.el.querySelector(".listing-virtual-tour"));
  const xss = panel({ ...FULL, listingKey: "X", garageType: "<img src=x onerror=alert(1)>" });
  check("HTML in a stored fact is escaped, not rendered", xss.el.querySelectorAll(".listing-detail-facts img").length === 0);

  check("no script errors while loading page", errors.length === 0, errors.join(" | "));
  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
