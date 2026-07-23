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
const SELECT_FIELDS = [
  "ListingKey", "ListPrice", "City", "PostalCode", "Latitude", "Longitude",
  "BedroomsTotal", "BathroomsTotalInteger", "ParkingTotal", "PropertySubType",
  "StructureType", "StandardStatus", "ModificationTimestamp", "Media",
  "ListOfficeKey",
];

// ListPrice gt 50000 (not just "ne null") -- added 2026-07-21 after finding
// real $1-$5000 "Single Family" listings in production data (Pickering,
// Richmond Hill, Kitchener). Real agent-entered junk/placeholder prices, not
// a parsing bug. $50,000 is well below any real Ontario single family home
// price, so this can't accidentally exclude legitimate cheap listings.
const MIN_LIST_PRICE = 50000;

export function buildQuery(top, skip) {
  const cityList = HOMEPILOT_CITIES.map((c) => `'${c}'`).join(",");
  return new URLSearchParams({
    "$top": String(top),
    "$skip": String(skip),
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and StandardStatus eq 'Active' and ListPrice gt ${MIN_LIST_PRICE} and City in (${cityList})`,
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
