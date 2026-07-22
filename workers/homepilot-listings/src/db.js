// homepilot-listings — db module
// Writes CREA/DDF listing records into the D1 `listings` table. Extracted
// from the single-file index.js during the 2026-07-21 module split.

export async function upsertListing(db, r) {
  await db.prepare(
    `INSERT INTO listings (
      listing_key, list_price, city, postal_code, latitude, longitude,
      property_subtype, structure_type, bedrooms, bathrooms, parking_total,
      listing_url, brokerage_name, listing_status, last_updated
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(listing_key) DO UPDATE SET
      list_price=excluded.list_price, city=excluded.city, postal_code=excluded.postal_code,
      latitude=excluded.latitude, longitude=excluded.longitude,
      property_subtype=excluded.property_subtype, structure_type=excluded.structure_type,
      bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms, parking_total=excluded.parking_total,
      listing_status=excluded.listing_status, last_updated=excluded.last_updated`
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
    r.ModificationTimestamp || new Date().toISOString()
  ).run();
}

// NOTE (known gap, flagged 2026-07-21, deliberately not solved in this split
// per Sandeep's explicit decision): this only inserts/updates. It never
// removes a listing that's sold, delisted, or no longer matches the query.
// The `listings` table can only grow or get overwritten -- never shrink --
// across repeated /ingest runs. Revisit when building the scheduled 24hr
// refresh job (original plan step 4).
