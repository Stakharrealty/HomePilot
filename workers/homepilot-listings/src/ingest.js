// homepilot-listings — ingest module
// Shared logic for pulling listings from CREA and writing them into D1.
// Used by BOTH the manual /ingest HTTP route and the scheduled cron trigger
// (added 2026-07-21), so there's exactly one code path to test and trust --
// not two copies that could quietly drift apart.

import { getAccessToken } from "./auth.js";
import { buildCityQuery, buildOfficeQuery, API_BASE } from "./query.js";
import { HOMEPILOT_CITIES } from "./cities.js";
import { upsertListing, deleteStaleListings } from "./db.js";

// Per-city listing cap (added 2026-07-22, replacing a single global-capped
// query). Real production data found 2026-07-22: with one combined
// $top=500 query across all 49 cities, large-inventory cities (Ottawa 123,
// Hamilton 95, Kitchener 68) consumed most of the cap, leaving 14 cities
// -- including Brampton and Markham, not small towns -- with ZERO listings
// in D1. Not a data problem on CREA's end -- a fairness problem in how we
// queried. 25/city covers every city's realistic inventory (only 3 of 49
// cities exceeded 25 listings in that same production snapshot) while
// still capping any single city from starving the others.
const PER_CITY_LIMIT = 25;

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
async function fetchOfficeNames(token, officeKeys) {
  const lookup = new Map();
  for (let i = 0; i < officeKeys.length; i += OFFICE_BATCH_SIZE) {
    const batch = officeKeys.slice(i, i + OFFICE_BATCH_SIZE);
    const resp = await fetch(`${API_BASE}/Office?${buildOfficeQuery(batch).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) continue; // don't let one failed office batch break ingest
    const data = await resp.json();
    for (const office of data.value || []) {
      if (office.OfficeKey && office.OfficeName) {
        lookup.set(office.OfficeKey, office.OfficeName);
      }
    }
  }
  return lookup;
}

// Fetches up to PER_CITY_LIMIT listings for a single city. Returns [] on a
// failed request rather than throwing -- one city's CREA hiccup shouldn't
// abort the whole run and leave every OTHER city un-ingested too.
async function fetchListingsForCity(token, city) {
  try {
    const resp = await fetch(`${API_BASE}/Property?${buildCityQuery(city, PER_CITY_LIMIT).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { city, rows: [], failed: true };
    const data = await resp.json();
    return { city, rows: data.value || [], failed: false };
  } catch {
    return { city, rows: [], failed: true };
  }
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
      cityResults.push({ city: r.city, count: r.rows.length, failed: r.failed });
    }
  }

  const citiesWithZeroListings = cityResults.filter((r) => r.count === 0 && !r.failed).map((r) => r.city);
  const citiesFailed = cityResults.filter((r) => r.failed).map((r) => r.city);

  // Phase 2: look up brokerage names for every unique office in this batch,
  // in one (batched) pass, rather than one query per listing
  const uniqueOfficeKeys = [...new Set(allRows.map((r) => r.ListOfficeKey).filter(Boolean))];
  const officeNameLookup = uniqueOfficeKeys.length > 0
    ? await fetchOfficeNames(token, uniqueOfficeKeys)
    : new Map();

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
  let totalDeleted = 0;
  if (totalWritten > 0) {
    totalDeleted = await deleteStaleListings(env.DB, runStartedAt);
  }

  return {
    runStartedAt,
    totalWritten,
    totalDeleted,
    citiesQueried: HOMEPILOT_CITIES.length,
    citiesWithZeroListings,
    citiesFailed,
    officesLookedUp: uniqueOfficeKeys.length,
    officesFound: officeNameLookup.size,
  };
}
