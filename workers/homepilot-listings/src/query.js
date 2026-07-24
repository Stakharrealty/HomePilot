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
// - CommonInterest and PropertyAttachedYN: ADDED 2026-07-24, needed for
//   real property-type filtering (condo/town/semi/detached). Both
//   confirmed to exist on the Property entity via a live /metadata check
//   this session -- CommonInterest (Freehold/Condo-Strata/etc.) is the
//   real ownership-type field (StructureType alone cannot tell a condo
//   apartment from a freehold one). PropertyAttachedYN is CREA's only
//   signal for semi-detached -- there is NO "Semi-Detached" enum value
//   anywhere in the DDF schema (verified via full-text search of the
//   entire /metadata document, all 64 enum types); a semi-detached house
//   is StructureType=House with PropertyAttachedYN=true. NOT YET verified
//   that PropertyAttachedYN is actually populated with meaningful data by
//   real MLS boards -- that's the point of adding it here, to sample real
//   values via /test before trusting it in the ingest filter.
const SELECT_FIELDS = [
  "ListingKey", "ListPrice", "City", "PostalCode", "Latitude", "Longitude",
  "BedroomsTotal", "BathroomsTotalInteger", "ParkingTotal", "PropertySubType",
  "StructureType", "StandardStatus", "ModificationTimestamp", "Media",
  "ListOfficeKey", "CommonInterest", "PropertyAttachedYN",
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
export function buildQuery(top, skip) {
  const cityList = HOMEPILOT_CITIES.map((c) => `'${c}'`).join(",");
  return new URLSearchParams({
    "$top": String(top),
    "$skip": String(skip),
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and StandardStatus eq 'Active' and ListPrice gt ${MIN_LIST_PRICE} and City in (${cityList})`,
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
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and StandardStatus eq 'Active' and ListPrice gt ${MIN_LIST_PRICE} and City eq '${city}'`,
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
