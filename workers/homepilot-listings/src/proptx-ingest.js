// homepilot-listings — PropTx IDX ingest module
// Pulls Active listings from PropTx's RESO Web API (query.ampre.ca) for a
// given city and upserts them into the `listings` D1 table with
// source = 'PROPTX'.
//
// REDESIGNED 2026-09-18 after the first version hit Cloudflare Error 1102
// (Worker exceeded resource limits) on its very first real run
// (Mississauga, ~4,455 active listings): the original design tried to
// fetch EVERY page from PropTx (up to 45 pages for Mississauga) AND write
// every row individually (one D1 round-trip per listing) inside a single
// Worker invocation. Confirmed via a follow-up check that ZERO rows made
// it into D1 before the timeout -- it failed during the fetch/pagination
// phase, before a single write happened.
//
// Fix: ingestCityPage() now processes exactly ONE PropTx page (up to
// PAGE_SIZE listings) per call, and writes that page's rows to D1 in a
// SINGLE batched statement (D1's .batch()) instead of one round-trip per
// listing. It returns PropTx's own @odata.nextLink so the caller can pass
// it back in to continue from where it left off. A full city ingest is
// now a series of small, fast calls rather than one large one -- the
// scheduled cron handler will loop calls until nextLink is null, but each
// individual page-call is cheap enough to never approach the CPU limit.
//
// TEST PHASE: still scoped to being called manually against ONE test city
// (Mississauga) before being wired into a loop over all of
// HOMEPILOT_CITIES in the scheduled handler.
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
// - listing_key has a real UNIQUE index (sqlite_autoindex_listings_1),
//   confirmed live before this upsert logic was ever run against
//   production data -- ON CONFLICT(listing_key) is valid here

const PROPTX_BASE_URL = "https://query.ampre.ca/odata";

// A page smaller than PropTx's max (100) keeps each call comfortably
// under Cloudflare's CPU budget even with the batched D1 write and photo
// extraction included. Tunable if real-world timing allows larger pages.
const PAGE_SIZE = 25;

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
  // Residential + For Sale only (fixed 2026-09-18): the first real page
  // for Mississauga came back 20/25 leases or commercial (retail units,
  // offices, land, a business for sale, lease prices like $15/sqft).
  // HomePilot is for home buyers -- only residential homes for sale.
  return `StandardStatus eq 'Active' and City eq '${safeCity}' and TransactionType eq 'For Sale' and startswith(PropertyType,'Residential')`;
}

/**
 * Builds the starting URL for a city's first page.
 */
function buildStartUrl(cityName) {
  const filter = encodeURIComponent(buildCityFilter(cityName));
  return `${PROPTX_BASE_URL}/Property?$filter=${filter}&$select=${PROPERTY_SELECT_FIELDS}&$expand=Media&$top=${PAGE_SIZE}`;
}

/**
 * Fetches exactly ONE page from PropTx -- either the first page for a
 * city (pageUrl is null) or a continuation page (pageUrl is a prior
 * response's @odata.nextLink, passed through unchanged).
 */
async function fetchOnePage(cityName, token, pageUrl) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const url = pageUrl || buildStartUrl(cityName);
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`PropTx fetch failed (${resp.status}) for ${cityName}: ${errText.slice(0, 500)}`);
  }
  const data = await resp.json();
  return {
    listings: data.value || [],
    nextLink: data["@odata.nextLink"] || null,
  };
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
    // listing_url: the old DDF-era schema requires this to be NOT NULL
    // (DDF supplied a realtor.ca link). PropTx provides no external
    // listing page, so an empty string is stored -- honest "no link",
    // and the frontend (listings-display.js) already hides the
    // "View original listing" link when this is empty.
    listing_url: "",
    latitude: p.Latitude ?? null,
    longitude: p.Longitude ?? null,
    listing_status: p.StandardStatus ?? null,
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(), // excluded from the ON CONFLICT update below, so it keeps the first-seen time
    list_price: p.ListPrice ?? null,
    city: p.City ?? null,
    postal_code: p.PostalCode ?? null,
    display_address: p.UnparsedAddress ?? null,
    bedrooms: p.BedroomsTotal ?? null,
    bathrooms: p.BathroomsTotalInteger ?? null,
    parking_total: p.ParkingTotal ?? null,
    parking_spaces: p.ParkingSpaces ?? null,
    property_subtype: p.PropertySubType ?? null,
    structure_type: p.StructureType ? JSON.stringify(Array.isArray(p.StructureType) ? p.StructureType : [p.StructureType]) : null,
    transaction_type: p.TransactionType ?? null,
    standard_status: p.StandardStatus ?? null,
    public_remarks: p.PublicRemarks ?? null,
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
    list_office_name: p.ListOfficeName ?? null,
    list_aor: p.ListAOR ?? null,
    modification_timestamp: p.ModificationTimestamp ?? null,
    photos: JSON.stringify(photos),
    photos_full: JSON.stringify(photos),
    brokerage_name: p.ListOfficeName ?? null,
    source: "PROPTX",
    last_updated: new Date().toISOString(),
  };
}

/**
 * Builds a single prepared D1 statement for one row's upsert, WITHOUT
 * running it -- so a whole page's worth can be handed to db.batch() as
 * one atomic multi-statement call instead of N separate round-trips.
 */
function buildUpsertStatement(db, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const updateClause = columns
    .filter((c) => c !== "listing_key" && c !== "created_at")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  const sql = `
    INSERT INTO listings (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(listing_key) DO UPDATE SET ${updateClause}
  `;
  return db.prepare(sql).bind(...columns.map((c) => row[c]));
}

/**
 * Processes exactly ONE page of listings for a city: fetch, map, batch-
 * write to D1, return a continuation link. Designed to comfortably fit
 * within a single Worker invocation's CPU budget -- PAGE_SIZE is
 * deliberately smaller than PropTx's max to leave headroom.
 *
 * pageUrl: pass null/undefined to start a city from the beginning, or
 * pass a previous call's nextLink to continue from where it left off.
 */
export async function ingestCityPage(db, token, cityName, pageUrl) {
  const { listings, nextLink } = await fetchOnePage(cityName, token, pageUrl);

  const statements = [];
  const mappingErrors = [];
  for (const p of listings) {
    try {
      statements.push(buildUpsertStatement(db, mapPropertyToRow(p)));
    } catch (e) {
      mappingErrors.push({ listingKey: p.ListingKey, error: String(e.message || e) });
    }
  }

  let batchResults = [];
  if (statements.length > 0) {
    batchResults = await db.batch(statements);
  }

  return {
    city: cityName,
    fetchedThisPage: listings.length,
    upsertedThisPage: batchResults.length,
    mappingErrorCount: mappingErrors.length,
    mappingErrors: mappingErrors.slice(0, 5),
    nextLink,
    hasMorePages: !!nextLink,
  };
}
