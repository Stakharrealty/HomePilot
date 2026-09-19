// Full listing page (listing-full.html): every stored field, full photo
// gallery, full untruncated description, compliance block, and the card's
// "View Details" link that opens it.
//
// Same harness as listing_detail_page_test.js: jsdom over the local static
// server on :8843 (npx http-server -p 8843 -s), mocked fetch (never touches
// the real Worker).
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
const strip = (s) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
const fmt = (n) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
const API = "https://homepilot-listings.stakharrealty.workers.dev";

const LONG_REMARKS = "Beautiful family home. " + "Lots of natural light and a renovated kitchen. ".repeat(20) + "THE-VERY-END";

const FULL = {
  listingKey: "K1", listPrice: 850000, city: "Mississauga", cityRegion: null, postalCode: "L5B 1A1",
  brokerageName: "Test Realty Inc.", displayAddress: "12 Example St", propertyType: "detached",
  bedrooms: 4, bathrooms: 3, parkingSpaces: 2, parkingTotal: 3, garageType: "Attached", basement: "Finished",
  cooling: "Central Air", heatType: "Forced Air", yearBuilt: 2005, lotSizeArea: 40, lotSizeUnits: "Feet",
  taxAnnualAmount: 4200, taxYear: 2025, associationFee: null, associationFeeFrequency: null,
  virtualTourUrl: "https://tour.example.com/k1", publicRemarks: LONG_REMARKS,
  photos: ["https://cdn.example.com/p1.jpg", "https://cdn.example.com/p2.jpg", "https://cdn.example.com/p3.jpg"],
};
const SPARSE = { listingKey: "K2", listPrice: 500000, city: "Guelph", brokerageName: null, propertyType: "detached", photos: [] };
const CONDO = { ...FULL, listingKey: "K3", propertyType: "condo", taxAnnualAmount: null, associationFee: null, garageType: null };
const CONDO_REAL = { ...FULL, listingKey: "K4", propertyType: "condo", associationFee: 640, associationFeeFrequency: "Monthly" };

async function openPage({ listing, status = 200, search, fetchThrows = false }) {
  const calls = [];
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const qs = search !== undefined ? search : `?key=${listing ? listing.listingKey : "K1"}`;
  const dom = await JSDOM.fromURL("http://localhost:8843/listing-full.html" + qs, {
    runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (u) => {
        calls.push(String(u));
        if (fetchThrows) throw new Error("network down");
        return { ok: status === 200, status, json: async () => ({ listing }) };
      };
    },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const w = dom.window;
  const root = w.document.getElementById("lfRoot");
  return { w, doc: w.document, root, text: root.textContent, html: root.innerHTML, calls, errors };
}

(async () => {
  // =============== 1. static rules ===============
  const fullSrc = read("src/listing-full.js");
  const pageSrc = read("listing-full.html");
  const scripts = [...pageSrc.matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
  check("listing-full.html loads the expected scripts, in order (no leadform / AI / insights, no listing-detail.js)",
    JSON.stringify(scripts) === JSON.stringify(["src/config.js", "src/listing-page-globals.js", "src/cities.js", "src/mortgage.js", "src/utils.js", "src/i18n.js", "src/explainability.js", "src/ai.js", "src/buyer-profile.js", "src/listings-display.js", "src/listing-fit.js", "src/listing-full.js"]), scripts.join());
  check("listing-full.js makes exactly one network call, to the listings API", (fullSrc.match(/\bfetch\(/g) || []).length === 1 && /fetch\(`\$\{LISTINGS_API_BASE\}\/listing\?key=/.test(fullSrc));
  check("no AI / third-party calls (Article 6.2(k))", !/insights|anthropic|haiku|claude|openai|gpt|XMLHttpRequest|sendBeacon|analytics/i.test(strip(fullSrc)));
  check("reuses the shared helpers instead of reimplementing them",
    /ldEstimates\(/.test(fullSrc) && /moneyFactOrEstimate\(/.test(fullSrc) && /factOrOmit\(/.test(fullSrc) && /attachPhotoCarousel\(/.test(fullSrc) && /renderIdxNotice\(/.test(fullSrc) &&
    !/function (ldEstimates|factOrOmit|moneyFactOrEstimate|attachPhotoCarousel)\b/.test(fullSrc));
  check("deploy.yml copies listing-full.html into the deploy folder", /cp listing-full\.html deploy\//.test(read(".github/workflows/deploy.yml")));
  check("the deferred (not-yet-stored) fields are not on the page", !/square|sqft|sq\.? ?ft|room size|utilities included|inclusion|exclusion|days on market|frontage|architectural|approximate age|sewer/i.test(strip(fullSrc)));
  check("no lat/long, no listingUrl on the page", !/latitude|longitude|listingUrl/i.test(strip(fullSrc)));

  const display = read("src/listings-display.js");
  check("card: 'View original listing' label and the listingUrl dependency are gone", !/View original listing/.test(display) && !/safeUrl\(listing\.listingUrl\)/.test(display));
  check("card: the small inline 'View details' toggle is unchanged", /<span>View details<\/span>/.test(display) && /"Hide details"/.test(display));
  check("card: link href is built from the listing key only (no profile data)", /listing-full\.html\?key=\$\{encodeURIComponent\(detailKey\)\}/.test(display));

  // =============== 2. full listing renders every stored field ===============
  const A = await openPage({ listing: FULL });
  check("(A) no script errors", A.errors.length === 0, A.errors.join(" | "));
  check("(A) fetches only /listing?key= on the listings API", A.calls.length === 1 && A.calls[0] === `${API}/listing?key=K1`, A.calls.join());
  const fields = {
    price: fmt(850000), address: "12 Example St", city: "Mississauga", postal: "Postal code: L5B 1A1", beds: "Beds: 4", baths: "Baths: 3",
    parking: "Parking spaces: 2", total: "Total parking: 3", garage: "Garage: Attached", basement: "Basement: Finished",
    heating: "Heating: Forced Air", cooling: "Cooling: Central Air", year: "Year built: 2005", lot: "Lot size: 40 Feet",
    tax: `Property tax: ${fmt(4200)}/yr (2025)`, type: "Property type: Detached", brokerage: "Listed by Test Realty Inc.",
  };
  for (const [k, v] of Object.entries(fields)) check(`(A) shows ${k}`, A.text.includes(v), v);
  check("(A) real tax is not labelled as an estimate", !/Property tax \(estimated\)/.test(A.text));
  check("(A) heating is labelled 'Heating', never 'Heat source'", /Heating: Forced Air/.test(A.text) && !/Heat source/i.test(A.text));
  const tour = A.doc.querySelector("a.listing-virtual-tour");
  check("(A) virtual tour link opens safely in a new tab", !!tour && tour.href === "https://tour.example.com/k1" && tour.target === "_blank" && /noopener/.test(tour.rel));
  const remarks = A.doc.querySelector(".lf-remarks");
  check("(A) description is shown in full, untruncated, with no Read more toggle", !!remarks && remarks.textContent === LONG_REMARKS && remarks.textContent.includes("THE-VERY-END") && !/Read more/.test(A.text));

  // gallery
  const img = A.doc.querySelector("#lfGallery img.listing-photo");
  const counter = () => A.doc.querySelector(".listing-photo-counter").textContent;
  check("(A) gallery starts on photo 1 of 3", !!img && img.src === FULL.photos[0] && counter() === "1/3");
  A.doc.querySelector(".listing-photo-next").click();
  check("(A) next arrow shows photo 2 (the card carousel, reused)", img.src === FULL.photos[1] && counter() === "2/3");
  A.doc.querySelector(".listing-photo-next").click(); A.doc.querySelector(".listing-photo-next").click();
  check("(A) carousel wraps back to photo 1", img.src === FULL.photos[0] && counter() === "1/3");
  A.doc.querySelector(".listing-photo-prev").click();
  check("(A) previous arrow wraps to the last photo", img.src === FULL.photos[2] && counter() === "3/3");

  // compliance
  const brokerageEl = A.doc.querySelector(".listing-brokerage");
  check("(A) brokerage line uses the page's detail font size (15px, same as the other details)", !!brokerageEl && /font-size:15px/.test(pageSrc.match(/\.listing-brokerage\{[^}]*\}/)[0]) && /\.ld-facts li\{[^}]*font-size:15px/.test(pageSrc));
  const notice = A.doc.querySelector(".listings-idx-notice");
  check("(A) 'deemed reliable' notice, verbatim", !!notice && notice.textContent.includes("Listing information is deemed reliable but is not guaranteed accurate by PROPTX."));
  check("(A) bona fide interest notice, verbatim", !!notice && notice.textContent.includes("The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose."));
  check("(A) back link returns to that city's listings", A.doc.getElementById("ldBack").getAttribute("href") === "listings.html?city=Mississauga");

  // =============== 3. sparse listing: silent omission ===============
  const B = await openPage({ listing: SPARSE });
  check("(B) sparse listing: no script errors", B.errors.length === 0, B.errors.join(" | "));
  check("(B) never prints N/A / Not available / null / undefined for a missing field", !/N\/A|Not available|null|undefined/.test(B.text.replace("Brokerage not available", "")), B.text);
  check("(B) missing fields are omitted, not blank labels", !/Garage|Basement|Heating|Cooling|Year built|Lot size|Postal|Parking|Virtual tour|Description/.test(B.text));
  check("(B) no photos -> the 'No photo available' state, no arrows", /No photo available/.test(B.text) && !B.doc.querySelector(".listing-photo-nav"));
  check("(B) a missing brokerage still renders the brokerage line and both notices", /Listed by Brokerage not available/.test(B.text) && /deemed reliable/.test(B.text) && /bona fide interest/.test(B.text));
  check("(B) tax falls back to a labelled estimate when none is stored", /Property tax \(estimated\): \$[\d,]+\/yr/.test(B.text), B.text);

  // condo fee: estimate when missing, real when stored
  const C = await openPage({ listing: CONDO });
  check("(C) condo with no stored fee shows a labelled condo-fee estimate, and an estimated tax", /Condo fee \(estimated\): \$[\d,]+\/mo/.test(C.text) && /Property tax \(estimated\)/.test(C.text), C.text);
  const D = await openPage({ listing: CONDO_REAL });
  check("(D) condo with a stored fee shows the real fee, not an estimate", D.text.includes(`Condo fee: ${fmt(640)}/mo`) && !/Condo fee \(estimated\)/.test(D.text), D.text);
  check("(A) a non-condo with no stored fee shows no condo/association fee at all", !/Condo fee|Association fee/.test(A.text));

  // =============== 4. XSS + error states ===============
  const X = await openPage({ listing: { ...SPARSE, listingKey: "X", displayAddress: "<img src=x onerror=alert(1)>", city: "<script>alert(2)</script>", publicRemarks: "<script>alert(3)</script>", virtualTourUrl: "javascript:alert(4)", photos: ["javascript:alert(5)", "https://cdn.example.com/ok.jpg"], brokerageName: "<b>x</b>" } });
  check("(X) hostile values render as inert text: no injected elements", X.root.querySelectorAll("script, img[onerror], b").length === 0);
  check("(X) javascript: virtual tour URL is not linked", !X.doc.querySelector("a.listing-virtual-tour"));
  check("(X) javascript: photo URL is dropped, https photo kept", X.doc.querySelector("img.listing-photo") && X.doc.querySelector("img.listing-photo").src === "https://cdn.example.com/ok.jpg");
  const N = await openPage({ listing: null, status: 404, search: "?key=GONE" });
  check("(N) unknown key -> 'no longer available', no crash", /no longer available/.test(N.text) && N.errors.length === 0);
  const M = await openPage({ listing: null, search: "" });
  check("(M) missing key -> 'No listing specified', no fetch", /No listing specified/.test(M.text) && M.calls.length === 0);
  const F = await openPage({ listing: null, fetchThrows: true });
  check("(F) network failure -> friendly error, no crash", /Couldn't load this listing/.test(F.text) && F.errors.length === 0);

  // =============== 5. the card's "View Details" link ===============
  const cardDom = await JSDOM.fromURL("http://localhost:8843/index.html", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((r) => setTimeout(r, 1500));
  const cw = cardDom.window;
  const card = cw.renderListingCard({ ...FULL, listingUrl: "" }, null);
  const link = card.querySelector("a.listing-source-link");
  check("(card) 'View Details' link renders even though listingUrl is empty", !!link && link.textContent === "View Details", link && link.outerHTML);
  check("(card) it opens listing-full.html for that key in a new tab", !!link && link.getAttribute("href") === "listing-full.html?key=K1" && link.target === "_blank" && /noopener/.test(link.rel));
  const cardWithUrl = cw.renderListingCard({ ...FULL, listingUrl: "https://www.realtor.ca/x" }, null);
  check("(card) a stored listingUrl is ignored -- the link still targets the full page", cardWithUrl.querySelector("a.listing-source-link").getAttribute("href") === "listing-full.html?key=K1");
  check("(card) the existing 'View full details' link and inline toggle are untouched",
    !!card.querySelector("a.listing-detail-link") && card.querySelector("a.listing-detail-link").getAttribute("href") === "listing.html?key=K1" &&
    !!card.querySelector("button.listing-details-toggle") && /View details/.test(card.querySelector("button.listing-details-toggle").textContent));
  const noKey = cw.renderListingCard({ ...FULL, listingKey: "bad key!" }, null);
  check("(card) an unsafe listing key renders no link at all", noKey.querySelector("a.listing-source-link") === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
