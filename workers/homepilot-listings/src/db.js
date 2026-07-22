// homepilot-listings — db module
// Writes CREA/DDF listing records into the D1 `listings` table. Extracted
// from the single-file index.js during the 2026-07-21 module split.
//
// Stale-listing removal (added 2026-07-21, part of the scheduled refresh
// job): every row written by a given ingest run gets last_seen_at stamped
// with that run's start time. deleteStaleListings() then removes any row
// whose last_seen_at is older than the current run -- meaning CREA no
// longer returned it (sold, delisted, or no longer matches the filter).
// This is a "mark and sweep" pattern: mark every row touched this run,
// sweep away everything that wasn't.

export async function upsertListing(db, r, runStartedAt) {
  await db.prepare(
    `INSERT INTO listings (
      listing_key, list_price, city, postal_code, latitude, longitude,
      property_subtype, structure_type, bedrooms, bathrooms, parking_total,
      listing_url, brokerage_name, listing_status, last_updated, last_seen_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(listing_key) DO UPDATE SET
      list_price=excluded.list_price, city=excluded.city, postal_code=excluded.postal_code,
      latitude=excluded.latitude, longitude=excluded.longitude,
      property_subtype=excluded.property_subtype, structure_type=excluded.structure_type,
      bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms, parking_total=excluded.parking_total,
      listing_status=excluded.listing_status, last_updated=excluded.last_updated,
      last_seen_at=excluded.last_seen_at`
  ).bind(
    r.ListingKey,
    r.ListPrice || 0,
    r.City || "",
    r.PostalCode || null,
    r.Latitude || null,
    r.Longitude || null,
    r.PropertySubType || "",
    JSON.stringify(r.StructureType || []),
    r.BedroomsTotal || null,
    r.BathroomsTotalInteger || null,
    r.ParkingTotal || null,
    `https://www.realtor.ca/real-estate/${r.ListingKey}`,
    null,
    r.StandardStatus || "",
    r.ModificationTimestamp || new Date().toISOString(),
    runStartedAt
  ).run();
}

// Removes listings not touched by the current run -- i.e. CREA no longer
// returns them as matching Active Single Family in our 49 cities above the
// price floor. Returns the number of rows deleted.
export async function deleteStaleListings(db, runStartedAt) {
  const result = await db
    .prepare(`DELETE FROM listings WHERE last_seen_at IS NULL OR last_seen_at < ?`)
    .bind(runStartedAt)
    .run();
  return result.meta?.changes ?? 0;
}
