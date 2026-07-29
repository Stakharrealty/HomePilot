// homepilot-listings — query module
// Builds the OData query sent to CREA's DDF API. Extracted from the
// single-file index.js during the 2026-07-21 module split.

import { HOMEPILOT_CITIES } from "./cities.js";

export const API_BASE = "https://ddfapi.realtor.ca/odata/v1";

// $select field list history, so a future edit doesn't reintroduce a known
// bad field without checking tests/listings_metadata_field_test.js first:
// - DaysOnMarket: REMOVED 2026-07-21, confirmed invalid on Property entity
//   via live /metadata check ("Could not find a property named
//   'DaysOnMarket' on type 'DDF.Core.Entities.Property'")
// - ListOfficeName: REMOVED prior session, also confirmed invalid -- there
//   is NO flat office-name field on Property. Confirmed via /metadata
//   2026-07-22: only ListOfficeKey (a foreign key) exists here. The real
//   OfficeName lives on a completely separate Office entity -- see
//   buildOfficeQuery() below. No NavigationProperty/$expand exists linking
//   them, so this requires a genuinely separate query, not a join.
// - Media and ListOfficeKey: ADDED 2026-07-22, needed for the listing
//   display UI (photos + brokerage name, both required by CREA's DDF
//   display rules).
// - CommonInterest and PropertyAttachedYN: ADDED 2026-07-24, then ROLLED
//   BACK same day when a live 400 appeared, then RE-ADDED 2026-07-25 once
//   root-caused: the 400 was NEVER these two fields. It was
//   `StandardStatus eq 'Active'` in $filter (CREA stopped allowing that
//   clause; confirmed via isolated per-clause testing -- every other
//   clause worked fine alone and combined) plus, separately, PAGE_SIZE=200
//   exceeding CREA's real 100-row $top ceiling. Both fixed independently
//   of these two fields (see the $filter history below and PAGE_SIZE in
//   ingest.js). CommonInterest (Freehold/Condo-Strata/etc.) is the real
//   ownership-type field (StructureType alone cannot tell a condo
//   apartment from a freehold one). PropertyAttachedYN is CREA's only
//   signal for semi-detached -- there is NO "Semi-Detached" enum value
//   anywhere in the DDF schema (verified via full-text search of the
//   entire /metadata document, all 64 enum types); a semi-detached house
//   is StructureType=House with PropertyAttachedYN=true. See
//   PROPERTY_TYPE_FILTERS in db.js for how condo/semi/detached use these.
// - ListingURL, PublicRemarks, UnparsedAddress, InternetAddressDisplayYN,
//   YearBuilt, LotSizeArea, LotSizeUnits: ADDED 2026-07-25, for real in-app
//   listing detail (description, address, year built, lot size) instead
//   of a bare card that redirects out. Confirmed via /metadata all seven
//   exist on the Property entity.
//   - ListingURL replaces a previously GUESSED url pattern
//     (`realtor.ca/real-estate/${ListingKey}`) that was 404ing in
//     production -- CREA gives us the real, correct link directly.
//   - InternetAddressDisplayYN is a real seller-consent flag, not a data
//     quality field: CREA's own description is "states the seller has
//     allowed the listing address to be displayed on Internet sites."
//     UnparsedAddress must NEVER be shown/stored-as-displayable unless
//     this is true -- see the address handling in db.js.
// - OriginatingSystemName: ADDED 2026-07-29, DDF source-attribution audit.
//   Confirmed VALID via a live /field-probe run (2026-07-29T00:58:50Z):
//   HTTP 200, sample value "Cornwall & District Real Estate Board" -- a
//   real regional board name, not a placeholder/generic "CREA" label.
//   Only field added from SOURCE_ATTRIBUTION_CANDIDATE_FIELDS -- the other
//   6 candidates (OriginatingSystemKey, SourceSystemName, SourceSystemID,
//   SourceSystemKey, MemberBoardKey; ListAgentKey also confirmed valid but
//   not needed yet) were confirmed INVALID or intentionally left out by
//   that same probe run. Do NOT add any of those without a fresh
//   /field-probe confirming them first -- see query.js's
//   SOURCE_ATTRIBUTION_CANDIDATE_FIELDS comment for why this account's
//   valid-field-list doesn't match the RESO standard 1:1.
const SELECT_FIELDS = [
  "ListingKey", "ListPrice", "City", "PostalCode", "Latitude", "Longitude",
  "BedroomsTotal", "BathroomsTotalInteger", "ParkingTotal", "PropertySubType",
  "StructureType", "StandardStatus", "ModificationTimestamp", "Media",
  "ListOfficeKey", "CommonInterest", "PropertyAttachedYN",
  "ListingURL", "PublicRemarks", "UnparsedAddress", "InternetAddressDisplayYN",
  "YearBuilt", "LotSizeArea", "LotSizeUnits", "OriginatingSystemName",
];

// ListPrice gt 50000 (not just "ne null") -- added 2026-07-21 after finding
// real $1-$5000 "Single Family" listings in production data (Pickering,
// Richmond Hill, Kitchener). Real agent-entered junk/placeholder prices, not
// a parsing bug. $50,000 is well below any real Ontario single family home
// price, so this can't accidentally exclude legitimate cheap listings.
const MIN_LIST_PRICE = 50000;

// buildQuery(): all-49-cities-combined query. Used ONLY by /test (a quick
// 20-listing sanity sample) -- NOT used for real /ingest anymore.
//
// Why not: with one combined query capped by $top, CREA returns results in
// whatever order it chooses (observed: large-inventory cities like Ottawa,
// Hamilton, Kitchener dominate the front of the result set). Found in
// production 2026-07-22: after a real /ingest run, 14 of 49 cities
// (including Brampton, Markham -- not small towns) had ZERO listings in D1,
// not because CREA has none, but because the combined 500-record cap never
// reached them. Real ingestion now uses buildCityQuery() per-city instead
// -- see runIngest() in ingest.js.
export // StandardStatus removed from $filter 2026-07-24: CREA started rejecting
// it with 400 "StandardStatus cannot be used in the $filter query
// option" -- confirmed via isolated /debug-filter testing that this was
// the ONLY clause failing (every other clause worked fine alone and in
// combination). Investigated whether this needed a client-side status
// check as a replacement -- it doesn't: /debug-status-sample pulled 50
// Ontario Single Family listings with NO status filter at all, and all
// 50 came back "Active". CREA's National Shared Pool feed only ever
// distributes Active listings in the first place (this is how DDF is
// designed, not specific to our account) -- the StandardStatus filter
// was always redundant, just happened to also be harmless until CREA
// stopped allowing it to be queried.
function buildQuery(top, skip) {
  const cityList = HOMEPILOT_CITIES.map((c) => `'${c}'`).join(",");
  return new URLSearchParams({
    "$top": String(top),
    "$skip": String(skip),
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and ListPrice gt ${MIN_LIST_PRICE} and City in (${cityList})`,
    "$select": SELECT_FIELDS.join(","),
  });
}

// buildCityQuery(): one city per query, used by real /ingest (added
// 2026-07-22) so every one of the 49 cities gets a guaranteed, fair share
// of coverage regardless of how large any other city's inventory is.
// skip param added 2026-07-24: ingest now paginates through a city's full
// inventory (see PAGE_SIZE/MAX_PAGES_PER_CITY in ingest.js) rather than
// capping at one page -- "every listing the buyer qualifies for", not an
// arbitrary product-imposed ceiling.
export function buildCityQuery(city, top, skip = 0) {
  return new URLSearchParams({
    "$top": String(top),
    "$skip": String(skip),
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and ListPrice gt ${MIN_LIST_PRICE} and City eq '${city}'`,
    "$select": SELECT_FIELDS.join(","),
  });
}

// Fetches OfficeName for a batch of ListOfficeKey values. Office is a
// completely separate DDF entity from Property (confirmed via /metadata,
// 2026-07-22) -- there's no $expand shortcut, so this is a real second
// round-trip to CREA per ingest run. officeKeys should be deduplicated by
// the caller before calling this (ingest.js does this).
const OFFICE_SELECT_FIELDS = ["OfficeKey", "OfficeName"];

export function buildOfficeQuery(officeKeys) {
  const keyList = officeKeys.map((k) => `'${k}'`).join(",");
  return new URLSearchParams({
    "$filter": `OfficeKey in (${keyList})`,
    "$select": OFFICE_SELECT_FIELDS.join(","),
  });
}

// SOURCE_ATTRIBUTION_CANDIDATE_FIELDS (added 2026-07-28, DDF observability
// audit): candidate field names for "where did this listing come from?"
// attribution -- OriginatingSystemName/Key and SourceSystemName/ID/Key are
// real, standard RESO Data Dictionary Property Resource fields (confirmed
// against RESO's own published Data Dictionary, ddwiki.reso.org, this
// session). ListAgentKey is also a standard RESO Property field.
// MemberBoardKey has NO known RESO standard equivalent -- it's included
// here only because it was explicitly asked about; it is expected to fail
// and is kept in the candidate list so the probe below proves that rather
// than assuming it.
//
// NONE of these are confirmed to exist on CREA's actual DDF Property
// entity for this account. RESO "standard" does not mean "every RESO Web
// API implementation exposes it" -- this codebase already has two
// confirmed counterexamples (DaysOnMarket, ListOfficeName: both look like
// standard fields, both returned a live 400 "could not find a property
// named X" when added to $select). Do NOT add any of these to
// SELECT_FIELDS above without first confirming via the /field-probe route
// (index.js) or a live /metadata check -- see the migration file
// (migrations/0001_source_attribution.sql) for the incident this rule
// comes from.
export const SOURCE_ATTRIBUTION_CANDIDATE_FIELDS = [
  "OriginatingSystemName",
  "OriginatingSystemKey",
  "SourceSystemName",
  "SourceSystemID",
  "SourceSystemKey",
  "ListAgentKey",
  "MemberBoardKey",
];

// buildFieldProbeQuery(): isolates a single candidate field in its own
// $select, against a real (already-known-valid) $filter, $top=1. Mirrors
// the exact debugging method already used and documented in this codebase
// to root-cause the StandardStatus 400 (see the buildQuery() comment
// above: "confirmed via isolated per-clause testing that this was the
// ONLY clause failing"). One request per field, so a single bad field name
// can't mask or be masked by another -- the /field-probe route in
// index.js runs one of these per candidate and reports pass/fail
// individually, which is how "the official field names available" gets
// answered with evidence instead of assumption.
export function buildFieldProbeQuery(fieldName) {
  return new URLSearchParams({
    "$top": "1",
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and ListPrice gt ${MIN_LIST_PRICE}`,
    "$select": `ListingKey,${fieldName}`,
  });
}

// --- /ingest-probe support (added 2026-07-28, ingestion scope audit) ---
// Purpose: isolate whether our $filter clauses are excluding real GTA
// inventory, or whether CREA simply isn't returning it. Each test below
// adds exactly ONE clause on top of the previous test's baseline (Test 1
// has none of our production filters; Test 4 IS the production filter),
// so a jump in count between two adjacent tests points at exactly one
// clause as the cause -- same isolation principle as buildFieldProbeQuery
// above, applied to filter clauses instead of $select fields.
export const INGEST_PROBE_CITIES = ["Toronto", "Brampton", "Mississauga", "Vaughan", "Markham"];

export function buildProbeFilterClauses(city) {
  return {
    test1_cityOnly: `City eq '${city}'`,
    test2_withProvince: `StateOrProvince eq 'Ontario' and City eq '${city}'`,
    // test3 and test4 both branch off test2 independently (NOT stacked on
    // top of each other) -- this is deliberate, so a difference between
    // test3 and test4 isolates ListPrice's effect vs. PropertySubType's
    // effect separately, rather than confounding them.
    test3_withPrice: `StateOrProvince eq 'Ontario' and City eq '${city}' and ListPrice gt ${MIN_LIST_PRICE}`,
    test4_withSubtype: `StateOrProvince eq 'Ontario' and City eq '${city}' and PropertySubType eq 'Single Family'`,
  };
}

// buildIngestProbeQuery(): $top kept small (default 5) since the goal is
// a representative sample (first 5 of each field) plus a true total via
// $count=true -- NOT a full data pull. $count=true is a standard OData
// query option (distinct from any $select field name), so this carries
// none of the "looks standard, isn't on this entity" risk that field
// names like DaysOnMarket/ListOfficeName turned out to have; the route
// calling this still checks for @odata.count in the response rather than
// assuming CREA honors it for this account.
export function buildIngestProbeQuery(filterClause, selectFields, top = 5) {
  return new URLSearchParams({
    "$top": String(top),
    "$count": "true",
    "$filter": filterClause,
    "$select": selectFields.join(","),
  });
}
