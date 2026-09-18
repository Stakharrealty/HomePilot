import { BUTTON_TYPES, SHOWN_SUBTYPES, subtypesForButton, sqlInList } from "./home-types.js";

// homepilot-listings — db module
// D1 read path (getListingsByCity) and property-type classification logic
// for the `listings` table. Extracted from the single-file index.js during
// the 2026-07-21 module split.
//
// buildUpsertStatement / upsertListing / deleteStaleListings were removed
// here (2026-09-18) along with the rest of the DDF ingest pipeline --
// buildUpsertStatement was shaped entirely around CREA's DDF Property
// payload fields (r.ListingKey, r.Media, r.OriginatingSystemName, etc.),
// and deleteStaleListings implemented the DDF mark-and-sweep refresh
// pattern keyed to a DDF ingest run. Both need to be rebuilt against
// PropTx's actual field names once that integration is wired in -- do not
// assume the same shape carries over; confirm PropTx's real payload fields
// first, the same way CREA's were confirmed via /metadata and /field-probe
// (see git history on the removed query.js for why that mattered here).
//
// The read path below (getListingsByCity) DOES care which pipeline wrote a
// row (correction, 2026-09-18): the earlier version of this comment claimed
// otherwise, and that was wrong. 11,121 stale DDF rows (source=NULL, last
// touched by the DDF cron before it was removed) were still being served
// live to real buyers on myhomepilot.ca, undetected, because the DDF
// removal deleted the ingest CODE but never touched the DATA already sitting
// in D1. Fixed by requiring source = 'PROPTX' in the WHERE clause below --
// this correctly returns zero results for every city until the real PropTx
// ingest module exists and starts writing rows with source='PROPTX', which
// is the true empty-state behavior already decided as the product
// requirement for the PropTx transition (no DDF-shaped fallback, ever).
// The 11,121 old DDF rows are left in the table, untouched, in case they're
// useful for reference -- they are simply no longer reachable through this
// query.

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
// PROPERTY_TYPE_FILTERS (rebuilt 2026-09-18 for PropTx): the old DDF-era
// clauses read structure_type / common_interest / property_attached, which
// PropTx leaves empty ("[]" / NULL on every real row), so every PropTx
// listing classified as NULL and the 4 buttons returned nothing. Now built
// from home-types.js -- the same allow-list the ingest uses -- matching
// on TRIM(property_subtype) because PropTx sends "Semi-Detached " with a
// trailing space. Each label maps to exactly one button, so the 4 filters
// are mutually exclusive by construction.
const SUBTYPE_EXPR = "TRIM(property_subtype)";

export const PROPERTY_TYPE_FILTERS = Object.freeze(Object.fromEntries(
  BUTTON_TYPES.map((b) => [b, `${SUBTYPE_EXPR} IN ${sqlInList(subtypesForButton(b))}`])
));

// Only real homes on the allow-list are ever returned -- a parking space,
// locker, vacant land, commercial unit, or any label PropTx adds later is
// blocked here even if it's already sitting in D1.
export const SHOWN_HOMES_CLAUSE = `${SUBTYPE_EXPR} IN ${sqlInList(SHOWN_SUBTYPES)}`;

// STRETCH_MULTIPLIER (added 2026-07-29, affordability-consistency fix):
// MUST stay in sync with the identical 1.10 stretch tolerance already used
// on the main results page (see `buyPower*1.10` in src/render.js,
// `displayMax` computation). There is no shared module between this Worker
// and the static frontend to enforce this automatically -- if the main
// app's stretch tolerance ever changes, this constant needs updating too,
// by hand, or the listings page and the ranking page will quietly disagree
// about what counts as "reasonably affordable".
const STRETCH_MULTIPLIER = 1.10;

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
// searchBudget (added 2026-07-29): when provided, excludes any listing
// priced above searchBudget * STRETCH_MULTIPLIER -- the SAME 10%-stretch
// logic already used on the main results page (not a stricter cutoff and
// not a looser one; per explicit product decision, listings must match
// what the app already treats as "reasonably affordable" everywhere else).
// Optional and defensively validated (must be a finite positive number) --
// missing/invalid means no price ceiling at all, matching prior behavior
// exactly for any caller that doesn't pass it.
export async function getListingsByCity(db, city, limit = 20, propertyType = null, offset = 0, searchBudget = null) {
  const typeClause = propertyType && PROPERTY_TYPE_FILTERS[propertyType]
    ? ` AND ${PROPERTY_TYPE_FILTERS[propertyType]}`
    : "";

  const hasBudget = Number.isFinite(searchBudget) && searchBudget > 0;
  const budgetClause = hasBudget ? ` AND list_price <= ?` : "";

  // derivedTypeCase (added 2026-07-29, classification fix): built from the
  // EXACT SAME clause strings as PROPERTY_TYPE_FILTERS above, not a
  // separately-written duplicate -- this is deliberate, so the label
  // returned to the frontend and the filter that selected the row can
  // never drift apart into "two classification systems" (the original
  // audit's core complaint about this codebase). NULL means a shown home with no
  // button (Duplex/Triplex/Fourplex/Multiplex -- see home-types.js).
  const derivedTypeCase = `CASE
      WHEN ${PROPERTY_TYPE_FILTERS.condo} THEN 'condo'
      WHEN ${PROPERTY_TYPE_FILTERS.town} THEN 'town'
      WHEN ${PROPERTY_TYPE_FILTERS.semi} THEN 'semi'
      WHEN ${PROPERTY_TYPE_FILTERS.detached} THEN 'detached'
      ELSE NULL
    END AS derived_property_type`;

  // Bind params must be positional, in the EXACT order their `?`
  // placeholders appear in the SQL string above: city first, then the
  // optional budget ceiling (only present when budgetClause was added),
  // then limit/offset last -- get this order wrong and D1 silently binds
  // the wrong value to the wrong placeholder, no error, just wrong results.
  const bindParams = [city];
  if (hasBudget) bindParams.push(searchBudget * STRETCH_MULTIPLIER);
  bindParams.push(limit, offset);

  const result = await db
    .prepare(
      `SELECT listing_key, list_price, city, postal_code, bedrooms, bathrooms,
              parking_total, listing_url, brokerage_name, photos, last_updated,
              public_remarks, display_address, year_built, lot_size_area, lot_size_units,
              ${derivedTypeCase}
       FROM listings
       WHERE city = ? AND source = 'PROPTX' AND transaction_type = 'For Sale' AND ${SHOWN_HOMES_CLAUSE}${typeClause}${budgetClause}
       ORDER BY last_updated DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...bindParams)
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
    // real in-app listing detail. displayAddress is expected to be
    // consent-gated at write time by whatever ingest pipeline populates
    // this column -- it should be either a real seller-approved address
    // string or null, never a partial fallback, so the caller can treat
    // "truthy" as "safe to show". Confirm this rule is honored by the
    // PropTx ingest module once it's built.
    publicRemarks: row.public_remarks,
    displayAddress: row.display_address,
    yearBuilt: row.year_built,
    lotSizeArea: row.lot_size_area,
    lotSizeUnits: row.lot_size_units,
    propertyType: row.derived_property_type || null,
  }));
}
