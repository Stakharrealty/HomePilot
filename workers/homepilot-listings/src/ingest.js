// homepilot-listings — ingest module
// Shared logic for pulling listings from CREA and writing them into D1.
// Used by BOTH the manual /ingest HTTP route and the scheduled cron trigger
// (added 2026-07-21), so there's exactly one code path to test and trust --
// not two copies that could quietly drift apart.

import { getAccessToken } from "./auth.js";
import { buildQuery, buildOfficeQuery, API_BASE } from "./query.js";
import { upsertListing, deleteStaleListings } from "./db.js";

const PAGE_SIZE = 50;
const MAX_RECORDS = 500;
// CREA's OData 'in' operator hits a node-count limit around 100 (same issue
// solved for cities, see tests/listings_query_node_limit_test.js) -- so
// office key lookups are batched to stay safely under that.
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

export async function runIngest(env) {
  const runStartedAt = new Date().toISOString();
  const token = await getAccessToken(env);
  let skip = 0;
  let totalSeen = 0;
  const allRows = [];

  // Phase 1: fetch all matching Property rows (paginated)
  while (totalSeen < MAX_RECORDS) {
    const resp = await fetch(`${API_BASE}/Property?${buildQuery(PAGE_SIZE, skip).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    const rows = data.value || [];
    if (rows.length === 0) break;

    allRows.push(...rows);
    totalSeen += rows.length;
    skip += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

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
    totalSeen,
    officesLookedUp: uniqueOfficeKeys.length,
    officesFound: officeNameLookup.size,
  };
}
