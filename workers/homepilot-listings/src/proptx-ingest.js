// homepilot-listings — PropTx IDX ingest module
// Pulls Active listings from PropTx's RESO Web API (query.ampre.ca) for a
// given city and upserts them into the `listings` D1 table with
// source = 'PROPTX'.
//
// TEST PHASE (2026-09-18): scoped to run against ONE city at a time via
// ingestCity(), called with a single test city (Mississauga) before being
// wired into a loop over all of HOMEPILOT_CITIES. Do not call this for
// every city until the single-city output has been reviewed.
//
// Everything below reflects real, verified findings from this session's
// live investigation -- not assumptions:
// - Field names confirmed against real PropTx Property/Media records
//   ($metadata + real sample listings, 2026-09-18)
// - ListAgentFullName is never populated (0/100 real sample) -- not
//   selected, not stored, no UI should expect it
// - Media entries include multiple size variants per photo, each with its
//   own Permission field -- only "Public" variants may be used; "Private"
//   variants (e.g. LargestNoWatermark) must never be stored or displayed
// - YearBuilt and other fields are inconsistently present -- every field
//   beyond ListingKey/ListPrice/City/StandardStatus is treated as optional
// - Toronto requires startswith(City,'Toronto') rather than an exact
//   match (its own city_district handling), not implemented in this
//   single-test-city phase -- Mississauga uses a plain exact match
// - property_subtype (existing DDF-era column, no underscore) is reused
//   for PropTx's PropertySubType per explicit decision -- NOT the
//   redundant property_sub_type column added by migration 0002

const PROPTX_BASE_URL = "https://query.ampre.ca/odata";

// The exact set of fields pulled from PropTx per Property record. Chosen
// deliberately (not "everything available") per the explicit product
// decision not to store fields just because PropTx exposes them -- see
// migrations/0002_proptx_full_listing.sql for the full field-by-field
// rationale of what was kept vs. left out.
const PROPERTY_SELECT_FIELDS = [
  "ListingKey", "ListPrice", "City", "PostalCode", "UnparsedAddress",
  "StreetNumber", "StreetName", "StreetSuffix", "Latitude", "Longitude",
  "BedroomsTotal", "BathroomsTotalInteger", "ParkingTotal", "ParkingSpaces",
  "PropertyType", "PropertySubType", "StructureType", "TransactionType",
  "StandardStatus", "PublicRemarks", "YearBuilt", "LotSizeArea", "LotSizeUnits",
  "AssociationFee", "AssociationFeeFrequency", "TaxAnnualAmount", "TaxYear",
  "HeatType", "Cooling", "Basement", "GarageType",
  "VirtualTourURLBranded", "ListOfficeName", "ListAOR",
  "ModificationTimestamp",
].join(",");

/**
 * Builds the OData $filter clause for a single city, exact match.
 * NOTE: Toronto needs startswith(City,'Toronto') instead -- not handled
 * here yet, this function is for the single-test-city (Mississauga) phase.
 */
function buildCityFilter(cityName) {
  const safeCity = cityName.replace(/'/g, "''");
  return `StandardStatus eq 'Active' and City eq '${safeCity}'`;
}

/**
 * Fetches every Active listing for one city from PropTx, following
 * @odata.nextLink pagination until exhausted. Includes Media via $expand
 * so photos can be extracted per listing.
 */
async function fetchCityListings(cityName, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const filter = encodeURIComponent(buildCityFilter(cityName));
  let url = `${PROPTX_BASE_URL}/Property?$filter=${filter}&$select=${PROPERTY_SELECT_FIELDS}&$expand=Media&$top=100`;
  const allListings = [];
  let pageCount = 0;
  const MAX_PAGES = 20; // safety cap -- 100/page * 20 = 2,000 listings max per city per run, well above any single HomePilot city's real inventory

  while (url && pageCount < MAX_PAGES) {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`PropTx fetch failed (${resp.status}) for ${cityName}: ${errText.slice(0, 500)}`);
    }
    const data = await resp.json();
    allListings.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
    pageCount++;
  }

  return { listings: allListings, pagesFetched: pageCount, hitPageCap: pageCount >= MAX_PAGES };
}

/**
 * Extracts only PUBLIC-permission photo URLs from a listing's Media array,
 * preferring the "Large" size variant per photo (good balance of quality
 * vs. payload size for a listing detail page). Never includes any variant
 * whose Permission array does not contain "Public" -- confirmed necessary
 * 2026-09-18: PropTx's LargestNoWatermark variants are marked Private and
 * must never be surfaced.
 */
function extractPublicPhotoUrls(mediaArray) {
  if (!Array.isArray(mediaArray)) return [];
  const largeVariants = mediaArray.filter(
    (m) => m.MediaCategory === "Photo"
      && Array.isArray(m.Permission)
      && m.Permission.includes("Public")
      && m.ImageSizeDescription === "Large"
  );
  // Sort by PropTx's own Order field so the photo sequence matches what
  // the listing agent set, not arbitrary API return order.
  largeVariants.sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
  return largeVariants.map((m) => m.MediaURL).filter(Boolean);
}

/**
 * Maps one raw PropTx Property record (with expanded Media) into the
 * exact column shape of the `listings` D1 table. Every field beyond the
 * handful PropTx always returns is treated as possibly-null -- no
 * fallback guessing, ever (confirmed necessary: YearBuilt, condo fields,
 * etc. are inconsistently present even on real, complete listings).
 */
function mapPropertyToRow(p) {
  const photos = extractPublicPhotoUrls(p.Media);
  return {
    listing_key: p.ListingKey,
    list_price: p.ListPrice ?? null,
    city: p.City ?? null,
    postal_code: p.PostalCode ?? null,
    display_address: p.UnparsedAddress ?? null,
    bedrooms: p.BedroomsTotal ?? null,
    bathrooms: p.BathroomsTotalInteger ?? null,
    parking_total: p.ParkingTotal ?? null,
    parking_spaces: p.ParkingSpaces ?? null,
    // property_subtype: reusing the existing DDF-era column (no
    // underscore) per explicit decision -- NOT property_sub_type.
    property_subtype: p.PropertySubType ?? null,
    structure_type: p.StructureType ? JSON.stringify(Array.isArray(p.StructureType) ? p.StructureType : [p.StructureType]) : null,
    transaction_type: p.TransactionType ?? null,
    standard_status: p.StandardStatus ?? null,
    public_remarks: p.PublicRemarks ?? null, // existing column -- kept in sync with public_remarks_full below rather than a separate truncation step
    public_remarks_full: p.PublicRemarks ?? null,
    year_built: p.YearBuilt ?? null,
    lot_size_area: p.LotSizeArea ?? null,
    lot_size_units: p.LotSizeUnits ?? null,
    association_fee: p.AssociationFee ?? null,
    association_fee_frequency: p.AssociationFeeFrequency ?? null,
    tax_annual_amount: p.TaxAnnualAmount ?? null,
    tax_year: p.TaxYear ?? null,
    heat_type: p.HeatType ?? null,
    cooling: Array.isArray(p.Cooling) ? p.Cooling.join(", ") : (p.Cooling ?? null),
    basement: Array.isArray(p.Basement) ? p.Basement.join(", ") : (p.Basement ?? null),
    garage_type: p.GarageType ?? null,
    virtual_tour_url: p.VirtualTourURLBranded ?? null,
    list_office_name: p.ListOfficeName ?? null, // brokerage -- confirmed 100% populated, required display per Article 6.3(c)
    list_aor: p.ListAOR ?? null,
    modification_timestamp: p.ModificationTimestamp ?? null,
    photos: JSON.stringify(photos), // existing column, kept as the primary photos field the read path already uses
    photos_full: JSON.stringify(photos), // same list, mirrored per migration 0002's photos_full column
    brokerage_name: p.ListOfficeName ?? null, // existing column the read path (db.js) already selects and displays
    source: "PROPTX",
    last_updated: new Date().toISOString(),
  };
}

/**
 * Upserts one mapped row into D1. Uses listing_key as the natural key --
 * INSERT with ON CONFLICT DO UPDATE, so a listing already in the table
 * (from a prior ingest run) gets refreshed rather than duplicated.
 */
async function upsertListing(db, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const updateClause = columns
    .filter((c) => c !== "listing_key")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  const sql = `
    INSERT INTO listings (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(listing_key) DO UPDATE SET ${updateClause}
  `;
  await db.prepare(sql).bind(...columns.map((c) => row[c])).run();
}

/**
 * Runs a full ingest for ONE city: fetch from PropTx, map each listing,
 * upsert into D1. Returns a summary object for logging/verification --
 * does not throw on a single bad row, but does record it, so one
 * malformed listing can't silently kill the whole city's run.
 */
export async function ingestCity(db, token, cityName) {
  const { listings, pagesFetched, hitPageCap } = await fetchCityListings(cityName, token);

  let upserted = 0;
  const errors = [];
  for (const p of listings) {
    try {
      const row = mapPropertyToRow(p);
      await upsertListing(db, row);
      upserted++;
    } catch (e) {
      errors.push({ listingKey: p.ListingKey, error: String(e.message || e) });
    }
  }

  return {
    city: cityName,
    fetchedFromPropTx: listings.length,
    pagesFetched,
    hitPageCap,
    upserted,
    errorCount: errors.length,
    errors: errors.slice(0, 10), // cap error detail in the response, avoid a huge payload if something's systematically wrong
  };
}
