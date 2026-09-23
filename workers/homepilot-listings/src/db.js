import { BUTTON_TYPES, SHOWN_SUBTYPES, subtypesForButton, sqlInList } from "./home-types.js";
import { isDistrictCode, regionForCity } from "./toronto-districts.js";
import { cardForCommunity } from "./communities.js";

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

// FRESHNESS BOUND (added 2026-09-22, audit).
//
// Nothing in this pipeline ever removed a listing. The ingest upserts; there
// is no sweep (deleteStaleListings was removed with the DDF pipeline on
// 2026-09-18 and never rebuilt), and this read path filtered only on source
// and transaction_type. PropTx's query filters on StandardStatus eq 'Active',
// so a listing that SELLS simply stops arriving -- which means its stored row
// is never updated and never deleted, and HomePilot kept serving it as
// for-sale indefinitely.
//
// That is not hypothetical: 11,121 stale DDF rows were served live to real
// visitors for months before an incidental investigation found them (see the
// note at the top of this file).
//
// Two layers now:
//   1. standard_status must still say Active -- cheap, and catches any row
//      whose status was updated in place before it left the feed.
//   2. last_updated must be recent. This is the layer that actually works,
//      because a sold listing's row freezes the moment it leaves the feed.
//
// 36 hours, set against measured production behaviour on 2026-09-22.
//
// This was first written as 168h (7 days), chosen blind before anyone had
// looked at the database, erring loose so it could not hide a live listing.
// Querying production showed that was far too loose to do anything: of 14,489
// for-sale rows, 168h hid ZERO. The constant existed and bought nothing.
//
// What the measurement showed:
//   - the cron refreshes each city every 12h (REFRESH_AFTER_HOURS), and
//     Toronto's full pass takes roughly 6h spread across many firings, so a
//     genuinely live listing is re-seen every 12-18h worst case;
//   - 448 rows (3%) had not been seen for over 12h -- sold, expired or
//     withdrawn, and all of them being served as for-sale;
//   - a 24h bound hides 103 of those, and so does 36h: nothing sits between
//     24 and 36 hours, so 36h buys an extra half-day of headroom for a slow
//     pass at no cost in what it catches.
//
// The remaining ~345 rows sit in the 12-24h window, where live-but-not-yet-
// re-seen and actually-gone are indistinguishable from timestamps alone. No
// safe bound separates them. The real fix is a mark-and-sweep keyed to a
// COMPLETED pass (delete what the pass did not see); this bound is the
// backstop underneath it, not a replacement for it.
//
// Re-measure before changing: if REFRESH_AFTER_HOURS changes, or a city large
// enough to push a pass past ~30h is added, this needs to move with it. Too
// tight and live listings vanish; too loose and it does nothing at all.
//
// Re-measured 2026-09-22, when the ingest went from 4 cities to all 49.
// Against production, the 4 cities took ~5h for 580 pages (1.9 pages/min),
// so 37,791 listings would have been ~13h per pass -- close enough to this
// bound that a busy market would have started emptying cities that were
// working fine. The city list therefore did not ship alone: PAGE_SIZE went
// 25 -> 100 (made safe by filtering the Media expansion server-side) and
// TIME_BUDGET_MS 20s -> 60s, which puts a full pass under an hour. 36h
// stays, now with real headroom rather than by luck. The arithmetic is
// asserted in tests/listings_city_coverage_test.js so it cannot quietly
// stop being true.
export const MAX_LISTING_AGE_HOURS = 36;

export function freshnessCutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - MAX_LISTING_AGE_HOURS * 3600 * 1000).toISOString();
}

// MIN_LISTING_PRICE (added 2026-09-23): the floor under which a price is not a
// price. Some agents list a real, ordinary house at $1 so that it sorts to the
// top of every low-to-high search -- HomePilot sorts `list_price ASC`, so those
// listings landed at position 1 on the affected city's page.
//
// Measured against production the day this shipped: 36 such listings, and they
// are NOT junk records to be filtered by type. They are Detached, Semi-Detached,
// Att/Row/Townhouse, Condo Apartment, Triplex and Multiplex homes at real
// addresses in Aurora, Brampton, Mississauga, Oakville, Richmond Hill, Toronto
// and elsewhere -- indistinguishable from real inventory except for the price.
// So the home-type allow-list cannot catch them; only a price floor can.
//
// The damage was not just an odd sort order. The affordability engine took $1
// as the real price: one Hamilton listing's detail page read "$979/month, 13%
// of take-home, within your comfort affordability range" and "$6,401 cash to
// purchase". The single most prominent home in a city, costed as fiction.
//
// WHY $10,000 AND NOT $2. A literal ">= $2" would remove today's 36 and reopen
// the same exploit tomorrow at $2. The live price distribution says where the
// real boundary is: 36 listings at $1, then NOTHING AT ALL until $21,000. The
// floor sits in the middle of an empty band roughly four orders of magnitude
// wide, so it removes exactly the gamed listings, is far below any genuine
// Ontario home (the cheapest real ones here are $100k-$200k rural properties,
// which stay visible), and leaves no cheap rung for the next agent to game.
//
// A NULL price is excluded by the same comparison, deliberately: every number
// this app shows a buyer is derived from the price, so a listing without one
// has nothing to show.
//
// Filtered on READ, not at ingest, matching how staleness and home types are
// already handled. The row stays in D1, so if the agent corrects the price to
// a real number the listing simply reappears on the next refresh -- no backfill
// and no re-ingest needed.
export const MIN_LISTING_PRICE = 10000;

// The visibility rules every listing query shares, so the list endpoint and
// the single-listing endpoint can never disagree about what is servable.
// MIN_LISTING_PRICE is inlined rather than bound because it is a code constant,
// never user input -- which also keeps the positional bind order of both
// callers unchanged (the only `?` here is still the freshness cutoff).
export const VISIBLE_LISTING_CLAUSE =
  `source = 'PROPTX' AND transaction_type = 'For Sale' ` +
  `AND standard_status = 'Active' AND last_updated >= ? ` +
  `AND list_price >= ${MIN_LISTING_PRICE}`;

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

// PROPTX IDX Data Agreement Article 6.3(b): a consumer may view at most
// 100 listings in response to one inquiry. idxCappedLimit trims a page
// request so offset + limit never passes the 100th listing of a search;
// returns 0 once the cap is reached (the /listings route then returns an
// empty page without querying).
export const IDX_MAX_LISTINGS_PER_SEARCH = 100;
export function idxCappedLimit(limit, offset) {
  const l = Number.isFinite(limit) ? limit : 0;
  const o = Number.isFinite(offset) ? offset : 0;
  return Math.max(0, Math.min(l, IDX_MAX_LISTINGS_PER_SEARCH - o));
}

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
// cityMatchClause: how a city name matches the stored `city` column.
// Every city is an exact match EXCEPT Toronto, which PropTx stores as
// district-coded values ("Toronto C07", "Toronto W04") -- plain "Toronto"
// matches all of them (and a bare "Toronto" row if one ever exists).
// `districts` (optional, Toronto only) narrows to one sub-region card's
// TRREB district codes via the city_district column; codes are validated
// and inlined as literals, never user input.
// `communities` (optional) narrows to one community card's own
// neighbourhoods within a municipality that holds several -- Acton and
// Georgetown inside Halton Hills, King City inside King, Bradford inside
// Bradford West Gwillimbury. Bound as parameters, not inlined. See
// communities.js for where the values come from.
// Returns the SQL plus the positional binds it needs, in placeholder order.
export function cityMatchClause(city, districts = null, communities = null) {
  let sql, binds;
  if (city === "Toronto") {
    const base = "(city = 'Toronto' OR city LIKE 'Toronto %')";
    if (Array.isArray(districts) && districts.length > 0) {
      const codes = districts.filter(isDistrictCode);
      if (codes.length !== districts.length) throw new Error("Invalid Toronto district code");
      sql = `${base} AND city_district IN (${codes.map((c) => `'${c}'`).join(", ")})`;
      binds = [];
    } else {
      sql = base;
      binds = [];
    }
  } else {
    sql = "city = ?";
    binds = [city];
  }
  if (Array.isArray(communities) && communities.length > 0) {
    sql += ` AND community IN (${communities.map(() => "?").join(", ")})`;
    binds = [...binds, ...communities];
  }
  return { sql, binds };
}

const LISTING_COLUMNS = `listing_key, list_price, city, community, postal_code, bedrooms, bathrooms,
              parking_total, parking_spaces, listing_url, brokerage_name, photos, last_updated,
              public_remarks, display_address, year_built, lot_size_area, lot_size_units,
              tax_annual_amount, tax_year, association_fee, association_fee_frequency,
              garage_type, basement, cooling, heat_type, virtual_tour_url,
              mls_number, listed_date,
              lot_width, lot_depth, living_area_range, approximate_age`;

function buildDerivedTypeCase() {
  return `CASE
      WHEN ${PROPERTY_TYPE_FILTERS.condo} THEN 'condo'
      WHEN ${PROPERTY_TYPE_FILTERS.town} THEN 'town'
      WHEN ${PROPERTY_TYPE_FILTERS.semi} THEN 'semi'
      WHEN ${PROPERTY_TYPE_FILTERS.detached} THEN 'detached'
      ELSE NULL
    END AS derived_property_type`;
}

export async function getListingsByCity(db, city, limit = 20, propertyType = null, offset = 0, searchBudget = null, districts = null, communities = null) {
  const cityMatch = cityMatchClause(city, districts, communities);
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
  const derivedTypeCase = buildDerivedTypeCase();

  // Bind params must be positional, in the EXACT order their `?`
  // placeholders appear in the SQL string above: city first, then the
  // optional budget ceiling (only present when budgetClause was added),
  // then limit/offset last -- get this order wrong and D1 silently binds
  // the wrong value to the wrong placeholder, no error, just wrong results.
  // Bind params must be positional, in the EXACT order their `?` placeholders
  // appear in the SQL: city first, then the freshness cutoff (inside
  // VISIBLE_LISTING_CLAUSE), then the optional budget ceiling, then
  // limit/offset last. Get this order wrong and D1 silently binds the wrong
  // value to the wrong placeholder -- no error, just wrong results.
  const bindParams = [...cityMatch.binds, freshnessCutoffIso()];
  if (hasBudget) bindParams.push(searchBudget * STRETCH_MULTIPLIER);
  bindParams.push(limit, offset);

  const result = await db
    .prepare(
      `SELECT ${LISTING_COLUMNS},
              ${derivedTypeCase}
       FROM listings
       WHERE ${cityMatch.sql} AND ${VISIBLE_LISTING_CLAUSE} AND ${SHOWN_HOMES_CLAUSE}${typeClause}${budgetClause}
       ORDER BY list_price ASC, last_updated DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...bindParams)
    .all();

  return (result.results || []).map(mapListingRow);
}

// One D1 row -> the listing object the API returns. Shared by the list
// query and the single-listing query so the two can never drift apart.
function mapListingRow(row) {
  return {
    listingKey: row.listing_key,
    listPrice: row.list_price,
    city: row.city,
    // HomePilot's own market name for this listing: "Toronto - North York"
    // for a "Toronto C07" row, and "Acton" for a Halton Hills row whose
    // community is Acton. Lets the detail page pick the right city record
    // for its cost math -- without this, an Acton listing would be costed
    // against Halton Hills and a King City listing against nothing at all,
    // since the app has no "King" record. Null when the row's own city is
    // already the card name (Hamilton, Guelph, Halton Hills itself).
    cityRegion: regionForCity(row.city) || cardForCommunity(row.city, row.community),
    postalCode: row.postal_code,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    parkingTotal: row.parking_total,
    parkingSpaces: row.parking_spaces,
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
    // lotWidth/lotDepth/livingAreaRange/approximateAge (migration 0005):
    // confirmed via live investigation to be the actually-populated PropTx
    // fields (see migration comment) -- lotWidth/lotDepth are the primary
    // lot-size signal now (lot_size_area stays for the rare fallback case).
    lotWidth: row.lot_width,
    lotDepth: row.lot_depth,
    livingAreaRange: row.living_area_range,
    approximateAge: row.approximate_age,
    // Stored PropTx fields exposed to the frontend (already populated by
    // the ingest; null when PropTx didn't supply them -- never guessed).
    taxAnnualAmount: row.tax_annual_amount,
    taxYear: row.tax_year,
    associationFee: row.association_fee,
    associationFeeFrequency: row.association_fee_frequency,
    garageType: row.garage_type,
    basement: row.basement,
    cooling: row.cooling,
    virtualTourUrl: row.virtual_tour_url,
    heatType: row.heat_type,
    // MLS number: PropTx's ListingId when the ingest has stored one, otherwise
    // listing_key -- live data shows the IDX feed returns no ListingId, and
    // ListingKey values are already in MLS format (e.g. "W13656642"). Decision
    // (Sandeep): use listing_key for now. Listed date stays null until a real
    // source field is found -- never guessed.
    mlsNumber: row.mls_number || row.listing_key || null,
    listedDate: row.listed_date,
    // latitude/longitude are deliberately NOT returned: exact coordinates
    // would reveal the address even where displayAddress is withheld, and
    // PropTx's address-display consent fields were never requested. Hold
    // until a map feature exists AND that consent question is answered.
    propertyType: row.derived_property_type || null,
  };
}

// Single listing by key, for the listing detail page. Same visibility rules
// as the list query: PROPTX rows only, For Sale, allow-listed home types --
// anything else is "not found", never served. Returns the full untruncated
// remarks and the full photo set where the ingest stored them (Article
// 6.3(f): content shown verbatim), falling back to the list columns.
export async function getListingByKey(db, listingKey) {
  if (typeof listingKey !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(listingKey)) return null;
  const derivedTypeCase = buildDerivedTypeCase();
  const result = await db
    .prepare(
      `SELECT ${LISTING_COLUMNS}, public_remarks_full, photos_full,
              ${derivedTypeCase}
       FROM listings
       WHERE listing_key = ? AND ${VISIBLE_LISTING_CLAUSE} AND ${SHOWN_HOMES_CLAUSE}
       LIMIT 1`
    )
    .bind(listingKey, freshnessCutoffIso())
    .all();
  const row = (result.results || [])[0];
  if (!row) return null;
  const listing = mapListingRow(row);
  listing.publicRemarks = row.public_remarks_full || row.public_remarks || null;
  try {
    const full = JSON.parse(row.photos_full || "[]");
    if (Array.isArray(full) && full.length > 0) listing.photos = full;
  } catch { /* keep the list-column photos */ }
  return listing;
}
