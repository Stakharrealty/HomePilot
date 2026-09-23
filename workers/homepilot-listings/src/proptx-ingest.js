import { classifySubtype } from "./home-types.js";
import { parseTorontoDistrict } from "./toronto-districts.js";
import { normalizeCommunity } from "./communities.js";
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
//   match -- handled in buildCityFilter(); every other city uses a plain
//   exact match. The district code is also stored in city_district.
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
// PAGE_SIZE raised 25 -> 100 (2026-09-22, full-coverage rollout). 100 is
// PropTx's maximum. The old value existed because a page carried the whole
// unfiltered Media expansion -- 22 MB for 100 listings, which a 128 MB
// Worker cannot safely parse. MEDIA_EXPAND below cuts that to 4.5 MB, which
// is what makes the larger page safe; the two changes belong together and
// neither should be reverted alone.
//
// Measured live 2026-09-22 against Barrie with the real $select, fetch time
// for one page:
//                     unfiltered Media      filtered Media
//   $top=25             2033 ms / 5.2 MB      ~700 ms / 1.0 MB
//   $top=100            6247 ms / 21.1 MB     1289 ms / 4.5 MB
//
// Per listing that is 81 ms -> 13 ms. Fewer, larger pages also mean fewer
// D1 round trips, since a page is written as one batch.
export const PAGE_SIZE = 100;

// Media is expanded with a server-side filter instead of being pulled whole.
// PropTx returns EVERY size variant of every photo plus documents -- 17,065
// media entries for 100 listings, of which the ingest keeps 3,380. Asking
// for the Large variants up front is a 4.7x smaller payload.
//
// Confirmed live 2026-09-22, three shapes tested:
//   $expand=Media($select=...)             -> 200 OK but ZERO rows. PropTx
//                                             does not support nested
//                                             $select; it silently returns
//                                             nothing rather than erroring.
//   $expand=Media($filter=...)             -> works, correct rows
//   adding "and MediaCategory eq 'Photo'"  -> identical result, slower
//                                             (1642 ms vs 1289 ms). The
//                                             size filter already excludes
//                                             documents, which carry a null
//                                             ImageSizeDescription.
//
// This is a pre-trim, NOT the rule. extractPublicPhotoUrls() below is still
// the authority on what may be stored and displayed -- it independently
// re-checks MediaCategory, Permission and ImageSizeDescription, so a feed
// change that widened what this filter returns could not leak a Private
// variant into the database.
export const MEDIA_EXPAND = "$expand=Media($filter=ImageSizeDescription eq 'Large')";

// CITY_CARD_NAME: ingest target -> the HomePilot card name to store in the
// city column, for municipalities PropTx names differently from the app.
//
// A row's city column must ALWAYS hold a name the app knows, because two
// things downstream read it directly and neither can resolve anything else:
// listing-fit.js picks the market record by (cityRegion || city), and
// listing-detail.js builds the back link as listings.html?city=<that name>.
// Store a name the app does not have and the buyer silently gets the
// unknown-city cost defaults and a dead back link -- see the long note in
// cities.js for the full failure, which is exactly what an alias produced.
//
// Ottawa is here for a second reason on top of the rename: it is ingested by
// county and its rows arrive under 51 different district names, so p.City is
// never usable as the card name. The district is preserved in community.
export const CITY_CARD_NAME = Object.freeze({
  "East Luther Grand Valley": "Grand Valley",
  "Ottawa": "Ottawa",
});

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
  // MLS number + listed date (migration 0004). Confirmed live 2026-09-20 by
  // probing PropTx: ListingId and ListingContractDate are valid but always
  // null in the IDX feed; OriginalEntryTimestamp (when the listing was
  // entered) is populated, so it is the listed date. An unknown field in
  // $select makes PropTx answer 400.
  "ListingId", "OriginalEntryTimestamp",
  // Lot dimensions, living area range, building age (migration 0005).
  // Confirmed live 2026-09-22 via a field-availability investigation
  // (real $metadata + a 1,090-listing live sample): LotWidth/LotDepth are
  // 100% populated on lot-bearing types (vs. LotSizeArea's 11%);
  // LivingAreaRange is 93%/100%-on-real-homes (the correct square-footage
  // field -- PropTx has no exact number, only this bucketed range);
  // ApproximateAge is 41% populated (the correct building-age field --
  // YearBuilt is confirmed 0% across the full 1,090-listing sample).
  "LotWidth", "LotDepth", "LotSizeSource", "LivingAreaRange", "ApproximateAge",
  // CityRegion (migration 0006). PropTx names the community within the
  // municipality here -- the only field that tells an Acton listing apart
  // from a Georgetown one, since both are stored as City = "Halton Hills".
  // Confirmed live 2026-09-22: populated on 100% of the 689 Active homes in
  // Halton Hills, King and Bradford West Gwillimbury (zero nulls). See
  // communities.js for the values and why they are normalized before storage.
  "CityRegion",
].join(",");

/**
 * Builds the OData $filter clause for a single city, exact match.
 * Toronto uses startswith(City,'Toronto') (district-coded City values).
 */
export function buildCityFilter(cityName) {
  const safeCity = cityName.replace(/'/g, "''");
  // Toronto is stored by PropTx as TRREB district-coded values ("Toronto
  // C07", "Toronto W04"), never plain "Toronto" -- an exact match returns
  // nothing. See toronto-districts.js.
  //
  // Ottawa is the same problem with none of the same handholds: its 3,779
  // active homes are spread over 51 City values that share no prefix at all
  // ("Barrhaven", "Kanata", "Orleans - Cumberland and Area", "Glebe -
  // Ottawa East and Area"), so neither an exact match nor a startswith
  // finds them. This is why Ottawa was recorded on 2026-09-18 as a "genuine
  // zero-coverage city (not a naming issue)" -- it was a naming issue, and
  // Ottawa is the second-largest market in the feed after Toronto.
  //
  // CountyOrParish is the grouping that works: confirmed live 2026-09-22
  // that it is populated across the feed and that CountyOrParish eq
  // 'Ottawa' returns exactly those 3,779 listings. mapPropertyToRow() files
  // them under city "Ottawa" with the district kept in the community column,
  // so the read path needs no special case at all.
  const cityClause = cityName === "Toronto"
    ? "startswith(City,'Toronto')"
    : cityName === "Ottawa"
      ? "CountyOrParish eq 'Ottawa'"
      : `City eq '${safeCity}'`;
  // Residential + For Sale only (fixed 2026-09-18): the first real page
  // for Mississauga came back 20/25 leases or commercial (retail units,
  // offices, land, a business for sale, lease prices like $15/sqft).
  // HomePilot is for home buyers -- only residential homes for sale.
  return `StandardStatus eq 'Active' and ${cityClause} and TransactionType eq 'For Sale' and startswith(PropertyType,'Residential')`;
}

/**
 * Builds the starting URL for a city's first page.
 */
function buildStartUrl(cityName) {
  const filter = encodeURIComponent(buildCityFilter(cityName));
  return `${PROPTX_BASE_URL}/Property?$filter=${filter}&$select=${PROPERTY_SELECT_FIELDS}&${MEDIA_EXPAND}&$top=${PAGE_SIZE}`;
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
export function mapPropertyToRow(p, ingestCity = null) {
  const photos = extractPublicPhotoUrls(p.Media);
  // Ottawa is ingested by county, so every row comes back under one of 51
  // district names in City ("Barrhaven", "Kanata", "Glebe - Ottawa East and
  // Area"). HomePilot has a single Ottawa card, so the card name is stored
  // in city and the district is kept in community -- the same shape every
  // other community-bearing municipality already uses. Doing it here rather
  // than with a special case on the read path means /listings?city=Ottawa
  // is an ordinary exact match, and a listing's own page reports "Ottawa",
  // which is the name the app has a market record for.
  const isOttawa = ingestCity === "Ottawa";
  // The card name this row belongs to, when PropTx's own City is not it.
  const cardName = CITY_CARD_NAME[ingestCity] || null;
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
    city: cardName || p.City || null,
    // Bare TRREB district code for Toronto rows ("C07"); NULL elsewhere.
    city_district: parseTorontoDistrict(p.City),
    // Community within the municipality, normalized ("1045 - AC Acton" ->
    // "Acton"). NULL when PropTx sends nothing usable. See communities.js.
    community: isOttawa ? normalizeCommunity(p.City) : normalizeCommunity(p.CityRegion),
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
    lot_width: p.LotWidth ?? null,
    lot_depth: p.LotDepth ?? null,
    lot_size_source: p.LotSizeSource ?? null,
    living_area_range: p.LivingAreaRange ?? null,
    approximate_age: p.ApproximateAge ?? null,
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
    mls_number: p.ListingId ?? null,
    listed_date: p.OriginalEntryTimestamp ?? null,
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
  // Non-homes (parking, lockers, land, farms, etc. -- see home-types.js)
  // pass PropTx's Residential + For Sale filter but are never saved.
  const skippedNotAHome = {};
  for (const p of listings) {
    if (!classifySubtype(p.PropertySubType).shown) {
      const label = p.PropertySubType ?? "(blank)";
      skippedNotAHome[label] = (skippedNotAHome[label] || 0) + 1;
      continue;
    }
    try {
      statements.push(buildUpsertStatement(db, mapPropertyToRow(p, cityName)));
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
    skippedNotAHomeCount: Object.values(skippedNotAHome).reduce((a, b) => a + b, 0),
    skippedNotAHome,
    mappingErrorCount: mappingErrors.length,
    mappingErrors: mappingErrors.slice(0, 5),
    nextLink,
    hasMorePages: !!nextLink,
  };
}
