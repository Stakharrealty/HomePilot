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
//
// Photos + brokerage name (added 2026-07-22, for the listing display UI):
// - photos: extracted from r.Media (a Collection(Media) field), stored as a
//   JSON array of URLs. CREA's own display rules require their watermark on
//   listing photos -- MediaURL is assumed to already point to CREA's
//   pre-watermarked image, not a raw source photo. This has NOT been
//   visually confirmed yet (no live /ingest run with Media selected has
//   happened as of this commit) -- flagged as a real thing to verify before
//   this goes live, not assumed safe.
// - brokerageName: NOT extracted from Property (no such field exists there,
//   confirmed via /metadata). Must be looked up separately via
//   buildOfficeQuery() in query.js and passed in here by ingest.js, which
//   is the caller responsible for doing that second query and building an
//   officeKey -> officeName lookup map.
//
// - common_interest, property_attached (added 2026-07-24, property-type
//   filtering bug fix): CommonInterest (Freehold/Condo-Strata/etc.) and
//   PropertyAttachedYN, straight passthrough of what CREA returns. See the
//   SELECT_FIELDS comment in query.js for why these two specific fields
//   were chosen -- CommonInterest is the real condo signal (StructureType
//   alone can't tell a condo apartment from a freehold one), and
//   PropertyAttachedYN is CREA's only semi-detached signal (there is no
//   dedicated enum value for it anywhere in the DDF schema).
// property_attached is stored as 0/1/NULL (SQLite has no native boolean) --
// NULL specifically preserved (not coerced to 0) since "we don't know" and
// "confirmed not attached" are different things for filtering purposes.

function extractPhotoUrls(media) {
  if (!Array.isArray(media) || media.length === 0) return [];
  return media
    .map((m) => m.MediaURL)
    .filter((url) => typeof url === "string" && url.length > 0);
}

function toAttachedFlag(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  return null; // unknown/not provided by CREA for this listing
}

export async function upsertListing(db, r, runStartedAt, brokerageName) {
  const photos = extractPhotoUrls(r.Media);

  await db.prepare(
    `INSERT INTO listings (
      listing_key, list_price, city, postal_code, latitude, longitude,
      property_subtype, structure_type, bedrooms, bathrooms, parking_total,
      listing_url, brokerage_name, listing_status, last_updated, last_seen_at,
      photos, common_interest, property_attached
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(listing_key) DO UPDATE SET
      list_price=excluded.list_price, city=excluded.city, postal_code=excluded.postal_code,
      latitude=excluded.latitude, longitude=excluded.longitude,
      property_subtype=excluded.property_subtype, structure_type=excluded.structure_type,
      bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms, parking_total=excluded.parking_total,
      listing_status=excluded.listing_status, last_updated=excluded.last_updated,
      last_seen_at=excluded.last_seen_at, brokerage_name=excluded.brokerage_name,
      photos=excluded.photos, common_interest=excluded.common_interest,
      property_attached=excluded.property_attached`
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
    brokerageName || null,
    r.StandardStatus || "",
    r.ModificationTimestamp || new Date().toISOString(),
    runStartedAt,
    JSON.stringify(photos),
    r.CommonInterest || null,
    toAttachedFlag(r.PropertyAttachedYN)
  ).run();
}

// Removes listings not touched by the current run -- i.e. CREA no longer
// returns them as matching Active Single Family in our 49 cities above the
// price floor. Returns the number of rows deleted.
//
// SCOPED TO citiesToSweep (added 2026-07-23, bug fix): the mark-and-sweep
// pattern only works correctly if every row's city was actually
// re-confirmed this run. If a city's fetch fails mid-run (CREA rate limit,
// timeout, etc.), its OLD rows in D1 still carry a stale last_seen_at from
// a prior successful run -- a global, city-blind sweep would wrongly treat
// those as "no longer returned by CREA" and delete real, still-active
// listings just because we failed to re-check them this pass. Restricting
// the DELETE to only cities that were successfully queried this run means
// a failed city's existing listings are left untouched (neither confirmed
// nor deleted) until the next run actually re-confirms them.
export async function deleteStaleListings(db, runStartedAt, citiesToSweep) {
  if (!Array.isArray(citiesToSweep) || citiesToSweep.length === 0) return 0;
  const placeholders = citiesToSweep.map(() => "?").join(",");
  const result = await db
    .prepare(
      `DELETE FROM listings WHERE (last_seen_at IS NULL OR last_seen_at < ?) AND city IN (${placeholders})`
    )
    .bind(runStartedAt, ...citiesToSweep)
    .run();
  return result.meta?.changes ?? 0;
}

// PROPERTY_TYPE_FILTERS (added 2026-07-24, property-type filtering bug
// fix): maps the app's 4 buyer-facing property-type buttons to real SQL
// conditions over the fields confirmed via live /metadata inspection this
// session. 'semi' is a DERIVED signal, not a dedicated CREA field -- see
// the SELECT_FIELDS comment in query.js. structure_type is stored as a
// JSON-stringified array (e.g. '["House"]'), so matching uses a LIKE on
// the raw column rather than an exact match.
const PROPERTY_TYPE_FILTERS = {
  condo: `common_interest = 'Condo/Strata'`,
  town: `structure_type LIKE '%Row / Townhouse%'`,
  semi: `structure_type LIKE '%House%' AND property_attached = 1`,
  detached: `structure_type LIKE '%House%' AND (property_attached = 0 OR property_attached IS NULL) AND (common_interest = 'Freehold' OR common_interest IS NULL)`,
};

// Read path for the public /listings endpoint (added 2026-07-22, listing
// display UI). Returns listings for a given city, most recently updated
// first, capped at `limit` starting at `offset`. Parses the photos JSON
// column back into a real array for the caller -- callers should never see
// the raw JSON string.
// propertyType is optional -- 'all'/undefined/unrecognized all mean no
// type filter (matches prior behavior exactly, so existing callers that
// don't pass it are unaffected).
// offset added 2026-07-24 (removing the old fixed display cap, per
// Sandeep: buyers should be able to page through EVERY listing they
// qualify for, not just a first batch) -- the front end's "Load more"
// button increments this to fetch the next page.
export async function getListingsByCity(db, city, limit = 20, propertyType = null, offset = 0) {
  const typeClause = propertyType && PROPERTY_TYPE_FILTERS[propertyType]
    ? ` AND ${PROPERTY_TYPE_FILTERS[propertyType]}`
    : "";

  const result = await db
    .prepare(
      `SELECT listing_key, list_price, city, postal_code, bedrooms, bathrooms,
              parking_total, listing_url, brokerage_name, photos, last_updated
       FROM listings
       WHERE city = ?${typeClause}
       ORDER BY last_updated DESC
       LIMIT ? OFFSET ?`
    )
    .bind(city, limit, offset)
    .all();

  return (result.results || []).map((row) => ({
    listingKey: row.listing_key,
    listPrice: row.list_price,
    city: row.city,
    postalCode: row.postal_code,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    parkingTotal: row.parking_total,
    listingUrl: row.listing_url,
    brokerageName: row.brokerage_name,
    photos: (() => {
      try {
        return JSON.parse(row.photos || "[]");
      } catch {
        return [];
      }
    })(),
    lastUpdated: row.last_updated,
  }));
}
