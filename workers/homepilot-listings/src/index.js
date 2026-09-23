// homepilot-listings — entry point
// Serves the public /listings read endpoint. City list and D1 read logic
// live in dedicated modules -- see cities.js, db.js in this same folder.
//
// DDF removed (2026-09-18): the CREA/DDF ingest pipeline (auth.js,
// query.js, ingest.js) and its diagnostic routes (/test, /metadata,
// /field-probe, /ingest-probe, /ingest) and scheduled cron trigger were
// removed entirely, in favor of switching to PropTx IDX. Nothing writes to
// the `listings` D1 table until a PropTx ingest module is built and wired
// in here -- until then, /listings will correctly return an empty result
// for every city (no fallback, per explicit product decision).

import { districtsForRegion } from "./toronto-districts.js";
import { getListingsByCity, getListingByKey, cityMatchClause, idxCappedLimit, effectiveSort, validMinBeds, SHOWN_HOMES_CLAUSE, PROPERTY_TYPE_FILTERS } from "./db.js";
import { CITY_ALIASES, PUBLIC_CITY_NAMES, HOMEPILOT_CITIES } from "./cities.js";
import { communitiesForCity } from "./communities.js";
import { runSubtypeCensus } from "./proptx-census.js";
import { runAutoIngest, ensureStateTable, AUTO_INGEST_CITIES } from "./proptx-auto-ingest.js";

// PROPTX_DISPLAY_ENABLED (added 2026-09-18): master switch for showing
// PropTx IDX listings to buyers on the public /listings route. Was false
// while the PROPTX IDX Data Agreement Article 6.3 notices were missing;
// turned ON 2026-09-18 after (a) the notices, brokerage styling and
// 100-per-search cap shipped (commit 5dbde08) and (b) the first full
// Mississauga ingest finished clean (2,354 fetched, 2,310 homes saved,
// 44 non-homes skipped, 0 errors). Set to false to hide every PropTx
// listing from buyers at once -- ingest keeps running either way.
const PROPTX_DISPLAY_ENABLED = true;


// The 4 buyer-facing property-type buttons the main app supports. Anything
// else (including 'all', missing, or unrecognized) means no type filter --
// see PROPERTY_TYPE_FILTERS in db.js for what each one actually queries.
const VALID_PROPERTY_TYPES = new Set(["condo", "town", "semi", "detached"]);

const ALLOWED_ORIGIN = "https://myhomepilot.ca";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {

      // REMOVED 2026-09-22 (audit). Six unauthenticated diagnostic routes lived
      // here: /proptx-check-unique-constraint, /proptx-check-partial-ingest,
      // /proptx-subtype-census, /proptx-first-page-summary and
      // /proptx-ingest-status. Their own comments marked them ONE-TIME and
      // TEMPORARY ("delete with the other /proptx-* test routes"); they were
      // still public and still serving.
      //
      // They exposed the listings table index schema, row counts, raw listing
      // rows with brokerage names, tax amounts and coordinates, and ingest
      // error strings. /proptx-subtype-census was the serious one: it called
      // PropTx API on EVERY request using PROPTX_IDX_TOKEN, turning an
      // anonymous HTTP request into a third-party call on a metered,
      // contractually-limited feed -- a free quota-exhaustion path.
      // /proptx-ingest-status ran roughly six D1 queries per configured city
      // per request.
      //
      // CORS did not protect any of them: it restricts browsers, not curl.
      //
      // Ingest progress is still readable with `wrangler d1 execute` against
      // the proptx_ingest_state table. If a status route is wanted again, put
      // it behind a bearer secret rather than making it public.

      // /test, /metadata, /field-probe, /ingest-probe, /ingest were CREA/DDF
      // diagnostic and ingest routes -- removed 2026-09-18 along with the
      // rest of the DDF pipeline. Rebuild PropTx-equivalent diagnostic
      // routes here once that integration is being wired in, confirmed
      // against PropTx's actual API spec rather than assumed to match
      // CREA's shape.

      // PropTx IDX token verified working 2026-09-18 against
      // https://query.ampre.ca/odata/$metadata (200 OK, full Property
      // entity field list confirmed -- ListingKey, ListPrice, City,
      // PropertyType, ListAgentFullName, ListOfficeName, Media, etc. all
      // present as expected under the us.ampre.webapi namespace). The
      // temporary /proptx-metadata-check route used to confirm this has
      // been removed. Real PropTx ingest module goes here next.

      // CRITICAL FINDING, discovered and fixed live 2026-09-18: the
      // `listings` table was assumed empty after DDF removal but actually
      // held 11,121 stale DDF rows (source=NULL, from CREA-participating
      // boards -- TRREB, Ottawa Real Estate Board, Cornerstone, etc.)
      // still being served live to real myhomepilot.ca visitors, months
      // out of date. DDF removal deleted the ingest CODE but never
      // touched the DATA already sitting in D1, and nothing in the read
      // path filtered on source -- so stale listings kept flowing to
      // buyers completely undetected. Fixed in db.js: getListingsByCity
      // now requires source = 'PROPTX', correctly returning zero results
      // (true empty state) until the real PropTx ingest module exists.
      // Verified live: /listings?city=Hamilton went from serving 20 stale
      // DDF listings to count:0, then confirmed with a direct D1 query
      // across ALL 49 HOMEPILOT_CITIES (not just Hamilton) -- every single
      // city returned 0 visible rows after the fix, including Ottawa
      // (3,723 stale rows) and Hamilton (1,155). The 11,121 old rows are
      // left in the table untouched, just no longer reachable via
      // /listings. All one-time investigation/verification routes used to
      // find and confirm this have been removed.

      // Migration 0002 applied live 2026-09-18 (20 new nullable columns
      // for full PropTx listing detail + HomePilot's own affordability
      // breakdown support). Confirmed via PRAGMA table_info(listings)
      // after running -- all 20 landed successfully. NOTE: the pre-
      // existing schema already had a column named `property_subtype`
      // (no underscore between "sub" and "type") -- the new
      // `property_sub_type` column added here is a near-duplicate this
      // migration should not have introduced; the real ingest module
      // should write PropTx's PropertySubType into the EXISTING
      // `property_subtype` column, not the redundant new one.
      // See migrations/0002_proptx_full_listing.sql for full column
      // rationale. The one-time /proptx-migration-0002 runner route used
      // to apply this has been removed.

      // PropTx IDX investigation complete (2026-09-18). Summary of what was
      // confirmed via temporary diagnostic routes (all since removed):
      // - Token verified working against query.ampre.ca
      // - 43 of 49 HomePilot cities match PropTx's City field exactly
      // - Toronto listings use TRREB district codes (e.g. "Toronto C07",
      //   "Toronto W04") as their City value, NOT plain "Toronto" --
      //   startswith(City,'Toronto') recovers the true count (20,656
      //   active listings); decision made to store the full district code
      // - Acton and Georgetown both map to "Halton Hills"; King City maps
      //   to "King"; Bradford maps to "Bradford West Gwillimbury"
      // - Ottawa and Grand Valley are genuine zero-coverage cities (not a
      //   naming issue) -- Ottawa is OREB territory, a different board
      // - ListAgentFullName is empty on 100% of a 100-listing real sample
      //   across 5 cities -- only ListOfficeName (brokerage) is ever
      //   populated, which is also all Article 6.3(c) actually requires
      // - YearBuilt and other fields are inconsistently present -- schema
      //   must treat every field beyond ListingKey/ListPrice/City/
      //   StandardStatus as optional
      // Real PropTx ingest module goes here next.

      // Single listing for the listing detail page (listing.html?key=...).
      // Same visibility rules as /listings (PROPTX, For Sale, allow-listed
      // home types) and the same PROPTX_DISPLAY_ENABLED master switch: a
      // listing that wouldn't be shown in a list is "not found" here too.
      if (url.pathname === "/listing") {
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing required 'key' query param" }), {
            status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        const listing = PROPTX_DISPLAY_ENABLED ? await getListingByKey(env.DB, key) : null;
        if (!listing) {
          return new Response(JSON.stringify({ error: "Listing not found" }), {
            status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        return new Response(JSON.stringify({ listing }, null, 2), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      if (url.pathname === "/listings") {
        const requestedCity = url.searchParams.get("city");
        if (!requestedCity) {
          return new Response(JSON.stringify({ error: "Missing required 'city' query param" }), {
            status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        // Accept both real CREA-queryable cities AND display-only aliases
        // (Toronto sub-regions, Bolton) -- see CITY_ALIASES in cities.js.
        // Fixed 2026-07-24: this previously only accepted HOMEPILOT_CITIES,
        // silently 400-ing every Toronto sub-region and Bolton request.
        if (!PUBLIC_CITY_NAMES.includes(requestedCity)) {
          return new Response(JSON.stringify({ error: `Unknown city: ${requestedCity}` }), {
            status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        // Resolve to the real city D1 rows are actually stored under.
        const city = CITY_ALIASES[requestedCity] || requestedCity;
        // Toronto sub-region cards narrow to their TRREB districts (null
        // for every other request, including plain "Toronto"). See
        // toronto-districts.js for the mapping.
        const torontoDistricts = districtsForRegion(requestedCity);
        // Community cards narrow to their own neighbourhoods inside a
        // municipality that holds more than one card (null for every other
        // request). The alias above resolves "Acton" to the municipality
        // rows are stored under, "Halton Hills"; without this the Acton card
        // would then show all 263 Halton Hills listings, 140 of them in
        // Georgetown. See communities.js.
        const communities = communitiesForCity(requestedCity);

        const rawType = url.searchParams.get("type");
        const propertyType = VALID_PROPERTY_TYPES.has(rawType) ? rawType : null;

        const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
        // offset added 2026-07-24 for "Load more" pagination -- lets the
        // front end page through a city's full stored inventory instead of
        // being capped at the first `limit` rows.
        const offsetParam = parseInt(url.searchParams.get("offset") || "0", 10);
        const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
        // PROPTX IDX Data Agreement Article 6.3(b): at most 100 listings
        // per consumer inquiry. Paging (offset) can never reach past the
        // 100th listing of a search; limit is trimmed so offset+limit <= 100.
        const cappedLimit = idxCappedLimit(limit, offset);

        // budget (added 2026-07-29, affordability-consistency fix): the
        // recommended price the buyer was shown -- see openListingsWindow()
        // in listings-display.js for how the frontend chooses this value.
        // parseFloat + finite + positive check, same defensive pattern as
        // limit/offset above -- an invalid or missing value means no price
        // ceiling at all (matches prior behavior exactly for any caller,
        // old or new, that doesn't pass it).
        const budgetParam = parseFloat(url.searchParams.get("budget"));
        const searchBudget = Number.isFinite(budgetParam) && budgetParam > 0 ? budgetParam : null;

        // beds / sort (added 2026-09-23, IMPROVEMENT_PLAN.md 1.1): minimum
        // bedrooms (1-5; anything else means any) and the order -- best
        // match, price or newest. See validMinBeds() / LISTING_SORTS in db.js.
        const minBeds = validMinBeds(url.searchParams.get("beds"));
        const sort = effectiveSort(url.searchParams.get("sort"), searchBudget !== null);

        // PROPTX_DISPLAY_ENABLED gate (added 2026-09-18) -- see its
        // definition at the top of this file. While false, buyers get the
        // normal empty state for every city.
        const listings = PROPTX_DISPLAY_ENABLED && cappedLimit > 0
          ? await getListingsByCity(env.DB, city, cappedLimit, propertyType, offset, searchBudget, torontoDistricts, communities, { minBeds, sort })
          : [];
        return new Response(
          JSON.stringify({ city: requestedCity, propertyType: propertyType || "all", offset, searchBudget, minBeds, sort, count: listings.length, listings }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      return new Response(JSON.stringify({ error: "Not found. Try /listings" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      // The real error goes to the Worker log, never to the caller: D1 error
      // messages can carry SQL fragments and schema detail (audit, 2026-09-22).
      console.error("homepilot-listings request failed:", err && err.stack ? err.stack : err);
      return new Response(JSON.stringify({ error: "Something went wrong. Please try again shortly." }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  },

  // Cron trigger handler -- see wrangler.jsonc for the schedule (every 2
  // minutes). Each firing does one bounded unit of the automatic PropTx
  // ingest (proptx-auto-ingest.js): a few pages, cursor saved, then stop.
  // When a city is done and fresh, a firing costs one D1 read.
  async scheduled(event, env, ctx) {
    if (!env.PROPTX_IDX_TOKEN) return;
    ctx.waitUntil(runAutoIngest(env.DB, env.PROPTX_IDX_TOKEN));
  },
};
