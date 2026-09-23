// Live listings check: fails loudly if junk reaches buyers on production.
// IMPROVEMENT_PLAN.md 1.6: "Add a nightly check against the live listings API
// that fails loudly if junk listings appear."
//
// Every other listings test runs against fixtures. This one asks the real,
// deployed API -- the same URL the site calls -- because the failures that
// reached buyers before were all ones fixtures could not see: $1 listings from
// real agents, fractional resort shares filed as condos, building lots filed as
// "Detached", and 11,121 stale rows nobody knew were still being served.
//
// For every public city card it asks for the cheapest listings (where a gamed
// price surfaces first) and checks each one against the same rules the Worker
// enforces:
//   - a price at or above the floor (MIN_LISTING_PRICE in the Worker's db.js);
//   - not a building lot: no bedroom on anything that isn't a condo;
//   - not parking or a commercial unit: no bedroom AND no bathroom;
//   - a listing key, and a type the app can cost (or null for a plex).
// It also fails if the API errors, or if every city comes back empty (a
// silently broken query looks exactly like "no listings").
//
// Run: node tests/live_listings_check.js
// Scheduled nightly by .github/workflows/nightly-listings-check.yml.
// Needs network access; it is deliberately not part of the offline suites.

const path = require("path");
const { pathToFileURL } = require("url");

const API = process.env.LISTINGS_API_BASE || "https://homepilot-listings.stakharrealty.workers.dev";
const SRC = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

(async () => {
  // "King City" is both an ingest city and an alias, so de-duplicate.
  const PUBLIC_CITY_NAMES = [...new Set((await import(pathToFileURL(path.join(SRC, "cities.js")).href).PUBLIC_CITY_NAMES)];
  const { MIN_LISTING_PRICE } = await import(pathToFileURL(path.join(SRC, "db.js")).href);

  const problems = [];
  let citiesWithListings = 0, checked = 0;

  for (const city of PUBLIC_CITY_NAMES) {
    const url = `${API}/listings?${new URLSearchParams({ city, limit: "50", sort: "price" })}`;
    let body;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "homepilot-live-listings-check" } });
      if (!res.ok) { problems.push(`${city}: HTTP ${res.status}`); continue; }
      body = await res.json();
    } catch (e) {
      problems.push(`${city}: request failed (${e.message})`);
      continue;
    }
    const listings = Array.isArray(body.listings) ? body.listings : [];
    if (listings.length) citiesWithListings++;
    for (const l of listings) {
      checked++;
      const tag = `${city}: ${l.listingKey || "(no key)"} @ ${l.listPrice}`;
      const price = Number(l.listPrice);
      if (!l.listingKey) problems.push(`${tag} -- no listing key`);
      if (!(price >= MIN_LISTING_PRICE)) problems.push(`${tag} -- price under the $${MIN_LISTING_PRICE.toLocaleString()} floor`);
      if (l.bedrooms === 0 && l.propertyType !== "condo") problems.push(`${tag} -- no bedroom on a ${l.propertyType || "plex"}: land or a site`);
      else if (l.bedrooms === 0 && l.bathrooms === 0) problems.push(`${tag} -- a "condo" with no bedroom and no bathroom: parking or a commercial unit`);
      if (l.propertyType !== null && !["condo", "town", "semi", "detached"].includes(l.propertyType)) {
        problems.push(`${tag} -- unexpected type ${JSON.stringify(l.propertyType)}`);
      }
    }
    // Sorted cheapest first by the API itself; a broken order would hide junk
    // below the first page, so check the API honoured it.
    for (let i = 1; i < listings.length; i++) {
      if (Number(listings[i - 1].listPrice) > Number(listings[i].listPrice)) {
        problems.push(`${city}: sort=price is not cheapest first (${listings[i - 1].listPrice} before ${listings[i].listPrice})`);
        break;
      }
    }
  }

  // Coverage floor: all 49 ingest cities served listings on 2026-09-23. A
  // handful may legitimately be empty on a given night; most of them being
  // empty means the query is broken, not the market.
  const minCities = Math.floor(PUBLIC_CITY_NAMES.length * 0.8);
  if (citiesWithListings < minCities) {
    problems.push(`only ${citiesWithListings} of ${PUBLIC_CITY_NAMES.length} city cards returned any listings (expected at least ${minCities})`);
  }

  console.log(`Checked ${checked} listings across ${PUBLIC_CITY_NAMES.length} city cards (${citiesWithListings} with listings) at ${API}`);
  if (problems.length) {
    console.log(`\nFAIL -- ${problems.length} problem(s) a buyer could see right now:`);
    for (const p of problems.slice(0, 200)) console.log("  - " + p);
    if (problems.length > 200) console.log(`  ... and ${problems.length - 200} more`);
    process.exit(1);
  }
  console.log("PASS -- no junk listings on the live site.");
})().catch((e) => { console.error(e); process.exit(1); });
