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
//
// - listing_url, public_remarks, display_address, year_built, lot_size
//   (added 2026-07-25, real in-app listing detail): listing_url now stores
//   CREA's real ListingURL field -- the previous version GUESSED a URL
//   pattern (realtor.ca/real-estate/${ListingKey}) that was 404ing in
//   production, confirmed live. public_remarks is the real listing
//   description text, stored as-is.
//
//   display_address is NOT simply r.UnparsedAddress -- it is gated by
//   r.InternetAddressDisplayYN, a genuine seller-consent flag (CREA's own
//   description: "states the seller has allowed the listing address to be
//   displayed on Internet sites"). When that flag is anything other than
//   true, display_address is stored as NULL, full stop -- there is no
//   fallback to a partial/approximate address here, because we don't know
//   what the seller actually consented to beyond "not the full address".
//   This is a real privacy/compliance boundary, not a data-quality
//   judgment call -- getListingsByCity() must never backfill this column
//   from any other field.

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

// Only ever returns an address string when CREA explicitly says the seller
// consented to it being shown -- see the module-level comment above.
function consentGatedAddress(r) {
  if (r.InternetAddressDisplayYN !== true) return null;
  return r.UnparsedAddress || null;
}

// buildUpsertStatement / upsertListing split (added 2026-07-25, ingest
// performance fix): upsertListing() used to run(). directly inside a loop
// in ingest.js -- one awaited D1 round trip PER LISTING. With the artificial
// per-city cap removed (2026-07-24), a full ingest run could be writing
// thousands of rows this way, which was the real cause of Cloudflare
// Error 1102 "Worker exceeded resource limits" -- confirmed via a live
// /ingest run hitting it after the StandardStatus and PAGE_SIZE fixes were
// both already in place, so it wasn't either of those.
// buildUpsertStatement() returns a bound (not yet executed) D1 statement;
// ingest.js now collects these and runs them via env.DB.batch([...]) in
// chunks, so 100 listings = 1 D1 round trip instead of 100. upsertListing()
// is kept as a thin single-row wrapper (build + immediately run) so
// existing tests and any single-row caller don't need to change.
export function buildUpsertStatement(db, r, runStartedAt, brokerageName) {
  const photos = extractPhotoUrls(r.Media);

  return db.prepare(
    `INSERT INTO listings (
      listing_key, list_price, city, postal_code, latitude, longitude,
      property_subtype, structure_type, bedrooms, bathrooms, parking_total,
      listing_url, brokerage_name, listing_status, last_updated, last_seen_at,
      photos, common_interest, property_attached,
      public_remarks, display_address, year_built, lot_size_area, lot_size_units,
      originating_system_name, originating_system_key, source_system_name,
      list_office_key, list_agent_key, member_board_key
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(listing_key) DO UPDATE SET
      list_price=excluded.list_price, city=excluded.city, postal_code=excluded.postal_code,
      latitude=excluded.latitude, longitude=excluded.longitude,
      property_subtype=excluded.property_subtype, structure_type=excluded.structure_type,
      bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms, parking_total=excluded.parking_total,
      listing_status=excluded.listing_status, last_updated=excluded.last_updated,
      last_seen_at=excluded.last_seen_at, brokerage_name=excluded.brokerage_name,
      photos=excluded.photos, common_interest=excluded.common_interest,
      property_attached=excluded.property_attached, listing_url=excluded.listing_url,
      public_remarks=excluded.public_remarks, display_address=excluded.display_address,
      year_built=excluded.year_built, lot_size_area=excluded.lot_size_area,
      lot_size_units=excluded.lot_size_units,
      originating_system_name=excluded.originating_system_name,
      originating_system_key=excluded.originating_system_key,
      source_system_name=excluded.source_system_name,
      list_office_key=excluded.list_office_key,
      list_agent_key=excluded.list_agent_key,
      member_board_key=excluded.member_board_key`
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
    // listing_url falls back to "" (not null) -- the D1 column is NOT
    // NULL, and a real constraint violation on even one row in a batch
    // chunk would abort that ENTIRE chunk's transaction (see
    // env.DB.batch() in ingest.js), silently losing up to 49 other
    // listings' worth of real data over one missing field. safeUrl() on
    // the front end already treats "" as "no link" gracefully (renders as
    // href="#"), so this has no visible behavior change for the listings
    // that DO have a real ListingURL (confirmed 20/20 present in a live
    // sample, 2026-07-25) -- it's purely a safety net for the rare case.
    r.ListingURL || "",
    brokerageName || null,
    r.StandardStatus || "",
    r.ModificationTimestamp || new Date().toISOString(),
    runStartedAt,
    JSON.stringify(photos),
    r.CommonInterest || null,
    toAttachedFlag(r.PropertyAttachedYN),
    r.PublicRemarks || null,
    consentGatedAddress(r),
    r.YearBuilt || null,
    r.LotSizeArea || null,
    r.LotSizeUnits || null,
    // Source-attribution fields (2026-07-28 DDF observability audit):
    // deliberately defensive with `|| null`, NOT `|| ""` like listing_url
    // above -- these are diagnostic/analytical fields, not something the
    // UI renders, so there's no XSS/display reason to coerce to a string,
    // and a real NULL here is meaningfully different from an empty string
    // (NULL = "CREA didn't give us this field"; "" would falsely look like
    // "CREA gave us this field and it was blank"). None of these are in
    // SELECT_FIELDS yet (see query.js), so today every one of these will
    // be null for every row -- that's expected and correct until a
    // /field-probe-confirmed field is added to SELECT_FIELDS.
    r.OriginatingSystemName || null,
    r.OriginatingSystemKey || null,
    r.SourceSystemName || null,
    r.ListOfficeKey || null,
    r.ListAgentKey || null,
    r.MemberBoardKey || null
  );
}

export async function upsertListing(db, r, runStartedAt, brokerageName) {
  await buildUpsertStatement(db, r, runStartedAt, brokerageName).run();
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

// PROPERTY_TYPE_FILTERS -- REWRITTEN 2026-07-29 (classification audit + fix).
// Original version (2026-07-24) had two confirmed, measured bugs, found via
// a full D1 frequency-table audit against all 11,546 live listings:
//
//   1. `structure_type LIKE '%House%'` is a case-INSENSITIVE substring match
//      in SQLite, and "Row / Townhouse" contains the substring "house"
//      (town-HOUSE). This meant the 'semi' filter was matching 2,565
//      townhouses alongside the 421 real semi-detached houses -- 86% of
//      what "Semi-Detached" returned was wrong. Fixed by anchoring the
//      match to the JSON-array-quoted token `"House"` (LIKE '%"House"%'),
//      which "Townhouse" does not contain (no quote immediately precedes
//      "house" inside "Townhouse").
//   2. 'condo' had no structure_type restriction, so condo-owned townhouses
//      (common_interest='Condo/Strata', structure_type='Row / Townhouse')
//      matched BOTH 'condo' and 'town' simultaneously -- 1,305 listings
//      appeared under two buttons at once. Fixed by making ownership
//      (common_interest = 'Condo/Strata') the FIRST, highest-priority
//      check -- 'town'/'semi'/'detached' now all explicitly exclude
//      Condo/Strata, so a condo townhouse only ever matches 'condo'.
//
// Deliberate product decision (confirmed 2026-07-29): stay at 4 buyer-
// facing categories, not 5 -- 'condo' now means "any Condo/Strata-owned
// listing" (apartment OR townhouse structure), 'town' means freehold
// townhouse only. No new button/label needed anywhere in the frontend.
//
// Mobile/Modular homes (145 listings) are deliberately NOT folded into any
// of the 4 categories (explicit decision, not an oversight) -- they simply
// match none of the 4 filters, same as before this fix, and remain
// invisible to all 4 buttons.
//
// These conditions are mutually exclusive for every real combination
// observed in production D1 (verified via the full frequency-table audit):
// condo is common_interest-first, so it can never overlap with the other
// three; town/semi/detached are separated by structure_type ("Row /
// Townhouse" vs "House", quote-anchored so they can't collide), and semi
// vs detached are separated by property_attached (1 vs 0/NULL).
const PROPERTY_TYPE_FILTERS = {
  condo: `common_interest = 'Condo/Strata'`,
  town: `structure_type LIKE '%"Row / Townhouse"%' AND common_interest IN ('Freehold','Leasehold')`,
  semi: `structure_type LIKE '%"House"%' AND property_attached = 1 AND (common_interest IS NULL OR common_interest != 'Condo/Strata')`,
  detached: `structure_type LIKE '%"House"%' AND (property_attached = 0 OR property_attached IS NULL) AND (common_interest IS NULL OR common_interest != 'Condo/Strata')`,
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

  // derivedTypeCase (added 2026-07-29, classification fix): built from the
  // EXACT SAME clause strings as PROPERTY_TYPE_FILTERS above, not a
  // separately-written duplicate -- this is deliberate, so the label
  // returned to the frontend and the filter that selected the row can
  // never drift apart into "two classification systems" (the original
  // audit's core complaint about this codebase). NULL means none of the 4
  // categories matched (mobile/modular homes, true edge cases -- 201
  // listings, ~1.7% of D1, confirmed via audit).
  const derivedTypeCase = `CASE
      WHEN ${PROPERTY_TYPE_FILTERS.condo} THEN 'condo'
      WHEN ${PROPERTY_TYPE_FILTERS.town} THEN 'town'
      WHEN ${PROPERTY_TYPE_FILTERS.semi} THEN 'semi'
      WHEN ${PROPERTY_TYPE_FILTERS.detached} THEN 'detached'
      ELSE NULL
    END AS derived_property_type`;

  const result = await db
    .prepare(
      `SELECT listing_key, list_price, city, postal_code, bedrooms, bathrooms,
              parking_total, listing_url, brokerage_name, photos, last_updated,
              public_remarks, display_address, year_built, lot_size_area, lot_size_units,
              ${derivedTypeCase}
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
    // publicRemarks/displayAddress/yearBuilt/lotSize added 2026-07-25 for
    // real in-app listing detail. displayAddress is already consent-gated
    // at write time (see consentGatedAddress() above) -- it is either a
    // real seller-approved address string or null, never a partial
    // fallback, so the caller can treat "truthy" as "safe to show".
    publicRemarks: row.public_remarks,
    displayAddress: row.display_address,
    yearBuilt: row.year_built,
    lotSizeArea: row.lot_size_area,
    lotSizeUnits: row.lot_size_units,
    propertyType: row.derived_property_type || null,
  }));
}
