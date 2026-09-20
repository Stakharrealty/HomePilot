// Listing card: the buyer's total monthly cost, one figure at the right end of
// the beds/baths row (.listing-facts-row). It must be exactly the calculator
// engine's calcCosts() total for this listing and this buyer -- with real
// PropTx tax / condo fee overriding the estimates -- and must never be a
// guessed number: no buyer profile or no usable price means no figure at all.
//
// jsdom over the local static server on :8843 (npx http-server -p 8843 -s).
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const fmt = (n) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
const norm = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").trim();

const PROFILE = { grossMonthlyIncome: 15000, netMonthlyIncome: 9800, downPayment: 170000, familySize: "3", existingDebt: 0, firstTimeBuyer: false, mortgageRate: 0.0419, savedAt: 1 };
const KEY = "hp_buyer_profile_v1";

(async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;
  const render = (l) => win.renderListingCard({ listingKey: "K1", listPrice: 850000, city: "Mississauga", photos: [], propertyType: "detached", brokerageName: "B", ...l }, null);
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent : null; };
  const cost = (el) => txt(el, ".listing-monthly-cost");

  // ---- the calculator's own answer for the same inputs (independent of listing-fit.js's helper) ----
  const expectedTotal = (listing, overrides) => win.eval(`(function () {
    const p = loadBuyerProfile();
    const l = ${JSON.stringify(listing)};
    const name = l.cityRegion || l.city;
    const market = M.find((c) => c.n === name);
    const saved = { r: customMortgageRate, f: firstTimeBuyer, n: netMonthlyIncome };
    try {
      customMortgageRate = p.mortgageRate || DEFAULT_MORTGAGE_RATE_PCT / 100;
      firstTimeBuyer = p.firstTimeBuyer === true;
      netMonthlyIncome = p.netMonthlyIncome;
      return calcCosts(market, l.listPrice, p.familySize, p.downPayment, l.propertyType || "detached", ${JSON.stringify(overrides || {})}).total;
    } finally { customMortgageRate = saved.r; firstTimeBuyer = saved.f; netMonthlyIncome = saved.n; }
  })()`);

  // =============== 1. no buyer profile -> no number ===============
  win.sessionStorage.removeItem(KEY);
  const noProfile = render({ bedrooms: 3, bathrooms: 2 });
  check("no buyer profile: no monthly figure on the card", cost(noProfile) === null && !/\/mo/.test(noProfile.textContent));
  check("no buyer profile: beds/baths row is exactly as before", txt(noProfile, ".listing-facts-row") !== null && norm(txt(noProfile, ".listing-facts-row")) === "Beds: 3 · Baths: 2");
  check("listingMonthlyCost(listing, null) is null", win.listingMonthlyCost({ listPrice: 850000, city: "Mississauga" }, null) === null);
  win.sessionStorage.setItem(KEY, "not json");
  check("corrupt stored profile: no figure, no crash", cost(render({ bedrooms: 3 })) === null);
  win.sessionStorage.setItem(KEY, JSON.stringify({ ...PROFILE, downPayment: -5 }));
  check("invalid stored profile (rejected by loadBuyerProfile): no figure", cost(render({ bedrooms: 3 })) === null);

  // =============== 2. with a profile: matches the calculator ===============
  win.sessionStorage.setItem(KEY, JSON.stringify(PROFILE));
  check("profile loads (sanity)", !!win.loadBuyerProfile());

  const base = { listPrice: 850000, city: "Mississauga", propertyType: "detached" };
  const A = render({ bedrooms: 3, bathrooms: 2 });
  const wantA = expectedTotal(base);
  check("number equals calcCosts().total for the same inputs (detached, estimated tax)", cost(A) === `${fmt(wantA)}/mo` && wantA > 0, `${cost(A)} vs ${fmt(wantA)}`);
  const computed = win.computeListingCosts({ ...base }, win.loadBuyerProfile());
  check("number equals computeListingCosts().costs.total (mortgage+tax+insurance+utilities+maintenance+condo fee)", computed.costs.total === wantA &&
    computed.costs.total === computed.costs.mort + computed.costs.tax + computed.costs.ins + computed.costs.util + computed.costs.maint + computed.costs.condoFee);
  check("helper returns the bare number", win.listingMonthlyCost({ ...base }, win.loadBuyerProfile()) === wantA);

  for (const [label, l] of [
    ["townhouse in Hamilton", { listPrice: 640000, city: "Hamilton", propertyType: "town" }],
    ["semi in Guelph", { listPrice: 560000, city: "Guelph", propertyType: "semi" }],
    ["Toronto district row via cityRegion", { listPrice: 900000, city: "Toronto C07", cityRegion: "Toronto - North York", propertyType: "detached" }],
    ["condo (estimated condo fee included)", { listPrice: 520000, city: "Mississauga", propertyType: "condo" }],
  ]) {
    const got = cost(render({ ...l, bedrooms: 2, bathrooms: 2 }));
    const want = expectedTotal(l);
    check(`matches the calculator: ${label}`, got === `${fmt(want)}/mo`, `${got} vs ${fmt(want)}`);
  }

  // =============== 3. real PropTx figures beat the estimates ===============
  const est = expectedTotal(base);
  const realTaxL = { ...base, taxAnnualAmount: 12000 };
  const realTax = expectedTotal(realTaxL, { taxAnnual: 12000 });
  check("real PropTx property tax overrides the estimate (12,000/yr)", cost(render({ ...realTaxL })) === `${fmt(realTax)}/mo` && realTax !== est, `${cost(render({ ...realTaxL }))} vs ${fmt(realTax)} (estimate ${fmt(est)})`);
  const condo = { listPrice: 520000, city: "Mississauga", propertyType: "condo" };
  const condoEst = expectedTotal(condo);
  const condoReal = { ...condo, associationFee: 640, associationFeeFrequency: "Monthly" };
  const wantCondoReal = expectedTotal(condoReal, { condoFeeMonthly: 640 });
  check("real condo fee (monthly) overrides the estimate", cost(render({ ...condoReal })) === `${fmt(wantCondoReal)}/mo` && wantCondoReal !== condoEst, `${cost(render({ ...condoReal }))} vs ${fmt(wantCondoReal)} (estimate ${fmt(condoEst)})`);
  const condoYearly = { ...condo, associationFee: 6000, associationFeeFrequency: "Annually" };
  check("real condo fee stated annually is converted to monthly first (6,000/yr = 500/mo)", cost(render({ ...condoYearly })) === `${fmt(expectedTotal(condoYearly, { condoFeeMonthly: 500 }))}/mo`);
  const both = { ...condo, taxAnnualAmount: 3100, associationFee: 512, associationFeeFrequency: "Monthly" };
  check("real tax and real condo fee together", cost(render({ ...both })) === `${fmt(expectedTotal(both, { taxAnnual: 3100, condoFeeMonthly: 512 }))}/mo`);
  const feeOnDetached = { ...base, associationFee: 999, associationFeeFrequency: "Monthly" };
  check("an association fee on a non-condo is ignored (same as the detail page)", cost(render({ ...feeOnDetached })) === `${fmt(est)}/mo`);
  const zeroTax = { ...base, taxAnnualAmount: 0 };
  check("a zero / missing real tax falls back to the estimate, not $0 tax", cost(render({ ...zeroTax })) === `${fmt(est)}/mo`);

  // =============== 4. no usable price -> no number ===============
  for (const bad of [null, undefined, 0, -100, "abc", NaN, ""]) {
    const c = render({ listPrice: bad, bedrooms: 3, bathrooms: 2 });
    check(`price ${JSON.stringify(bad)}: no monthly figure, never NaN or $0/mo`, cost(c) === null && !/NaN|\$0\/mo|undefined|null/.test(txt(c, ".listing-facts-row")), txt(c, ".listing-facts-row"));
  }
  check("helper: missing price -> null", win.listingMonthlyCost({ city: "Mississauga" }, win.loadBuyerProfile()) === null && win.listingMonthlyCost({ listPrice: 0, city: "Mississauga" }, win.loadBuyerProfile()) === null);

  // =============== 5. layout: same row as beds/baths, right-aligned, alone when needed ===============
  const row = A.querySelector(".listing-facts-row");
  check("the figure is inside the beds/baths row, after the beds/baths text (last child)", !!row && row.lastElementChild.classList.contains("listing-monthly-cost") && row.firstElementChild.classList.contains("listing-facts-text"));
  check("beds/baths text is unchanged next to it", txt(A, ".listing-facts-text") === "Beds: 3 · Baths: 2");
  check("row shows just beds/baths and one dollar figure: no label, no breakdown", /^Beds: 3 · Baths: 2\$[\d,]+\/mo$/.test(norm(row.textContent)), norm(row.textContent));
  check("exactly one monthly figure on the card, and no cost breakdown lines", A.querySelectorAll(".listing-monthly-cost").length === 1 && !/Mortgage|Insurance|Utilities|Maintenance|Condo fee|Property tax|per month|Total/i.test(A.textContent.replace(/Listed by/, "")));
  const noBB = render({});
  check("missing beds and baths: the figure still renders, alone, on the row", !!noBB.querySelector(".listing-facts-row") && !noBB.querySelector(".listing-facts-text") && norm(txt(noBB, ".listing-facts-row")) === `${fmt(wantA)}/mo`, norm(txt(noBB, ".listing-facts-row")));
  check("only beds present: beds text and the figure", norm(txt(render({ bedrooms: 2 }), ".listing-facts-row")) === `Beds: 2${fmt(wantA)}/mo`);
  check("card without a figure and without beds/baths has no empty row", !render({ listPrice: 0 }).querySelector(".listing-facts-row"));
  check("row sits after the price row and address, before the pill links and brokerage line", (() => {
    const c = render({ displayAddress: "1 Main St", bedrooms: 3, bathrooms: 2 });
    return [...c.querySelector(".listing-body").children].map((k) => k.className.split(" ")[0]).join(",") === "listing-price-row,listing-address,listing-meta,listing-links,listing-brokerage";
  })());
  check("brokerage line untouched by the new figure", txt(render({ mlsNumber: "W1", brokerageName: "Test Realty" }), ".listing-brokerage") === "W1 · Listed by Test Realty");

  // =============== 6. safety / plumbing ===============
  const before = win.eval("[customMortgageRate, firstTimeBuyer, netMonthlyIncome]").join();
  for (let i = 0; i < 5; i++) render({ bedrooms: 2 });
  check("rendering cards leaves the calculator's engine globals exactly as they were", win.eval("[customMortgageRate, firstTimeBuyer, netMonthlyIncome]").join() === before);
  const displaySrc = read("src/listings-display.js");
  const fitSrc = read("src/listing-fit.js");
  check("the card reuses the shared helper and never calls calcCosts itself", /listingMonthlyCost\(/.test(displaySrc) && !/calcCosts\(/.test(displaySrc.replace(/\/\/[^\n]*/g, "")) && /function listingMonthlyCost\(/.test(fitSrc) && /computeListingCosts\(listing, profile\)/.test(fitSrc.slice(fitSrc.indexOf("function listingMonthlyCost"))));
  check("the price is only ever escaped text (no injected markup from a hostile price)", (() => {
    const c = render({ listPrice: "<img src=x onerror=alert(1)>", bedrooms: 1 });
    return c.querySelectorAll("img:not(.listing-photo)").length === 0;
  })());
  check("the 10% ceiling constants are untouched", /const LD_STRETCH_MULTIPLIER = 1\.10;/.test(fitSrc) && /const STRETCH_MULTIPLIER = 1\.10;/.test(read("workers/homepilot-listings/src/db.js")));
  check("row CSS is present in index.html, listings.html and calculator.html (space-between, figure far right)",
    ["index.html", "listings.html", "calculator.html"].every((p) => {
      const h = read(p);
      return /\.listing-facts-row\{display:flex;justify-content:space-between/.test(h) && /\.listing-monthly-cost\{margin-left:auto/.test(h);
    }));
  check("no script errors", errors.length === 0, errors.join(" | "));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
