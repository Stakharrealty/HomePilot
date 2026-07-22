// homepilot-listings — ingest module
// Shared logic for pulling listings from CREA and writing them into D1.
// Used by BOTH the manual /ingest HTTP route and the scheduled cron trigger
// (added 2026-07-21), so there's exactly one code path to test and trust --
// not two copies that could quietly drift apart.

import { getAccessToken } from "./auth.js";
import { buildQuery, API_BASE } from "./query.js";
import { upsertListing, deleteStaleListings } from "./db.js";

const PAGE_SIZE = 50;
const MAX_RECORDS = 500;

export async function runIngest(env) {
  const runStartedAt = new Date().toISOString();
  const token = await getAccessToken(env);
  let skip = 0;
  let totalWritten = 0;
  let totalSeen = 0;

  while (totalSeen < MAX_RECORDS) {
    const resp = await fetch(`${API_BASE}/Property?${buildQuery(PAGE_SIZE, skip).toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    const rows = data.value || [];
    if (rows.length === 0) break;

    for (const r of rows) {
      await upsertListing(env.DB, r, runStartedAt);
      totalWritten++;
    }

    totalSeen += rows.length;
    skip += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

  // Mark-and-sweep: remove anything not touched by this run (sold,
  // delisted, or no longer matching the filter). Only runs if we actually
  // wrote at least one row this pass -- guards against a CREA outage or
  // auth failure silently wiping the whole table via a 0-listing "success".
  let totalDeleted = 0;
  if (totalWritten > 0) {
    totalDeleted = await deleteStaleListings(env.DB, runStartedAt);
  }

  return { runStartedAt, totalWritten, totalDeleted, totalSeen };
}
