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
const SELECT_FIELDS = [
  "ListingKey", "ListPrice", "City", "PostalCode", "Latitude", "Longitude",
  "BedroomsTotal", "BathroomsTotalInteger", "ParkingTotal", "PropertySubType",
  "StructureType", "StandardStatus", "ModificationTimestamp", "Media",
  "ListOfficeKey", "CommonInterest", "PropertyAttachedYN",
  "ListingURL", "PublicRemarks", "UnparsedAddress", "InternetAddressDisplayYN",
  "YearBuilt", "LotSizeArea", "LotSizeUnits",
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
