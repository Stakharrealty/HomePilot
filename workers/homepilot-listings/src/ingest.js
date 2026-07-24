// homepilot-listings — ingest module
// Shared logic for pulling listings from CREA and writing them into D1.
// Used by BOTH the manual /ingest HTTP route and the scheduled cron trigger
// (added 2026-07-21), so there's exactly one code path to test and trust --
// not two copies that could quietly drift apart.

import { getAccessToken } from "./auth.js";
import { buildCityQuery, buildOfficeQuery, API_BASE } from "./query.js";
import { HOMEPILOT_CITIES } from "./cities.js";
import { upsertListing, deleteStaleListings } from "./db.js";

// PAGE_SIZE / MAX_PAGES_PER_CITY (added 2026-07-24, replacing the old fixed
// PER_CITY_LIMIT=25 cap): Sandeep's explicit direction -- a buyer should
// see EVERY listing they qualify for, not a product-imposed sample. 25 was
// never a CREA limit, it was a leftover from the 2026-07-22 fairness fix
// (solved structurally by per-city queries; the 25 number itself was just
// "covers most cities in one snapshot", not a real ceiling).
// This now paginates through a city's full result set via $skip, stopping
// only when: (a) CREA returns fewer than PAGE_SIZE rows (no more results),
// or (b) MAX_PAGES_PER_CITY is hit (a genuine safety bound against a City
// filter somehow matching a huge unbounded result set and blowing past
// Cloudflare Workers' execution-time limit for a single ingest run -- NOT
// a realistic ceiling for any of the 49 Ontario cities HomePilot covers;
// 10 * 200 = 2,000 listings/city is far beyond any single city's real
// active Single Family inventory).
const PAGE_SIZE = 200;
const MAX_PAGES_PER_CITY = 10;

// How many city queries to run concurrently. Sequential (1 at a time) for
// 49 cities would be slow; unlimited concurrency risks hitting Cloudflare
// Workers' execution limits or CREA rate limits. 8 is a reasonable middle
// ground, not verified against any documented CREA rate limit (none found
// in their public docs) -- worth revisiting if ingest runs start failing.
const CITY_FETCH_CONCURRENCY = 8;

// Office lookups still use a combined 'in' clause (unlike cities, which
// moved to per-city queries 2026-07-22) since starving one office's name
// lookup has no fairness impact -- a missing brokerage name just shows a
// fallback, it doesn't hide an entire city's listings. Still batched to
// stay under CREA's ~100-node OData query limit.
const OFFICE_BATCH_SIZE = 80;

// Fetches OfficeName for a deduplicated list of ListOfficeKey values,
// batched to avoid CREA's query node limit. Returns a Map(officeKey ->
// officeName). Missing/failed lookups are simply absent from the map --
// callers should treat a missing key as "brokerage name unknown", not throw.
// Returns { lookup, failedBatches, failedKeyCount } rather than a bare Map
// (changed 2026-07-23, bug fix): a failed batch used to be silently
// dropped with zero logging or visibility, which was very likely the real
// cause of the 28% brokerage-name resolution rate this session never
// diagnosed. Callers still treat a missing key as "brokerage name
// unknown" -- this doesn't change ingest behavior, it just stops hiding
// the failure.
async function fetchOfficeNames(token, officeKeys) {
  const lookup = new Map();
  let failedBatches = 0;
  let failedKeyCount = 0;
  for (let i = 0; i < officeKeys.length; i += OFFICE_BATCH_SIZE) {
    const batch = officeKeys.slice(i, i + OFFICE_BATCH_SIZE);
    const resp = await fetch(`${API_BASE}/Office?${buildOfficeQuery(batch).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      failedBatches++;
      failedKeyCount += batch.length;
      // Visible in `wrangler tail` / Cloudflare Worker logs -- this used to
      // be a bare `continue` with no trace at all.
      console.error(
        `[homepilot-listings] Office lookup batch failed: status=${resp.status}, ` +
        `batchIndex=${i / OFFICE_BATCH_SIZE}, batchSize=${batch.length}`
      );
      continue; // don't let one failed office batch break ingest
    }
    const data = await resp.json();
    for (const office of data.value || []) {
      if (office.OfficeKey && office.OfficeName) {
        lookup.set(office.OfficeKey, office.OfficeName);
      }
    }
  }
  return { lookup, failedBatches, failedKeyCount };
}

// Fetches ALL listings for a single city, paginating via $skip until CREA
// returns a short page (fewer than PAGE_SIZE = no more results) or
// MAX_PAGES_PER_CITY is hit. Returns [] on a failed request rather than
// throwing -- one city's CREA hiccup shouldn't abort the whole run and
// leave every OTHER city un-ingested too. A failure on any page marks the
// WHOLE city failed (not partial) -- a partial result silently passed as
// "success" would let deleteStaleListings() wrongly sweep away real
// listings CREA has but this run didn't finish fetching.
// truncated (added 2026-07-24): true only if MAX_PAGES_PER_CITY was
// actually hit -- i.e. the safety wall fired for real, meaning this city's
// stored listings may be incomplete. This should never be true for any of
// HomePilot's 49 cities under normal conditions; if it ever is, it must
// show up in the /ingest response, not fail silently.
async function fetchListingsForCity(token, city) {
  const rows = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES_PER_CITY; page++) {
    try {
      const resp = await fetch(`${API_BASE}/Property?${buildCityQuery(city, PAGE_SIZE, page * PAGE_SIZE).toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return { city, rows: [], failed: true, truncated: false };
      const data = await resp.json();
      const pageRows = data.value || [];
      rows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) break; // last page -- no more results
      if (page === MAX_PAGES_PER_CITY - 1) {
        // Hit the wall on the LAST allowed page and it was still full --
        // there's more CREA data we didn't fetch. Log immediately (visible
        // in `wrangler tail`/Cloudflare Worker logs) in addition to
        // surfacing it in the returned result below.
        truncated = true;
        console.error(
          `[homepilot-listings] Pagination safety wall hit for city="${city}": ` +
          `stopped at ${rows.length} listings (MAX_PAGES_PER_CITY=${MAX_PAGES_PER_CITY}). ` +
          `CREA likely has more -- this city's D1 data is INCOMPLETE this run.`
        );
      }
    } catch {
      return { city, rows: [], failed: true, truncated: false };
    }
  }
  return { city, rows, failed: false, truncated };
}

export async function runIngest(env) {
  const runStartedAt = new Date().toISOString();
  const token = await getAccessToken(env);
  const allRows = [];
  const cityResults = []; // per-city outcome, for real visibility into coverage

  // Phase 1: fetch each city's listings separately (bounded concurrency),
  // so no single city's inventory can starve the others out of the run.
  for (let i = 0; i < HOMEPILOT_CITIES.length; i += CITY_FETCH_CONCURRENCY) {
    const batch = HOMEPILOT_CITIES.slice(i, i + CITY_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map((city) => fetchListingsForCity(token, city)));
    for (const r of results) {
      allRows.push(...r.rows);
      cityResults.push({ city: r.city, count: r.rows.length, failed: r.failed, truncated: r.truncated });
    }
  }

  const citiesWithZeroListings = cityResults.filter((r) => r.count === 0 && !r.failed).map((r) => r.city);
  const citiesFailed = cityResults.filter((r) => r.failed).map((r) => r.city);
  // citiesTruncated (added 2026-07-24): should be [] under all normal
  // conditions -- see the truncated comment on fetchListingsForCity above.
  // Surfaced here (not just console.error'd) so a real occurrence is
  // visible in the /ingest response itself, not just Worker logs someone
  // has to go looking for.
  const citiesTruncated = cityResults.filter((r) => r.truncated).map((r) => r.city);

  // Phase 2: look up brokerage names for every unique office in this batch,
  // in one (batched) pass, rather than one query per listing
  const uniqueOfficeKeys = [...new Set(allRows.map((r) => r.ListOfficeKey).filter(Boolean))];
  const officeLookupResult = uniqueOfficeKeys.length > 0
    ? await fetchOfficeNames(token, uniqueOfficeKeys)
    : { lookup: new Map(), failedBatches: 0, failedKeyCount: 0 };
  const officeNameLookup = officeLookupResult.lookup;

  // Phase 3: write everything to D1
  let totalWritten = 0;
  for (const r of allRows) {
    const brokerageName = officeNameLookup.get(r.ListOfficeKey) || null;
    await upsertListing(env.DB, r, runStartedAt, brokerageName);
    totalWritten++;
  }

  // Mark-and-sweep: remove anything not touched by this run (sold,
  // delisted, or no longer matching the filter). Only runs if we actually
  // wrote at least one row this pass -- guards against a CREA outage or
  // auth failure silently wiping the whole table via a 0-listing "success".
  //
  // SCOPED to citiesSucceeded, not the whole table (bug fix 2026-07-23):
  // see the comment on deleteStaleListings() in db.js. A city whose fetch
  // failed this run must not have its existing listings swept just because
  // they weren't re-confirmed -- that's a fetch failure, not evidence the
  // listings are gone.
  const citiesSucceeded = cityResults.filter((r) => !r.failed).map((r) => r.city);
  let totalDeleted = 0;
  if (totalWritten > 0) {
    totalDeleted = await deleteStaleListings(env.DB, runStartedAt, citiesSucceeded);
  }

  return {
    runStartedAt,
    totalWritten,
    totalDeleted,
    citiesQueried: HOMEPILOT_CITIES.length,
    citiesWithZeroListings,
    citiesFailed,
    citiesTruncated,
    citiesSweptForStaleRemoval: citiesSucceeded.length,
    officesLookedUp: uniqueOfficeKeys.length,
    officesFound: officeNameLookup.size,
    officeLookupFailedBatches: officeLookupResult.failedBatches,
    officeLookupFailedKeyCount: officeLookupResult.failedKeyCount,
  };
}
