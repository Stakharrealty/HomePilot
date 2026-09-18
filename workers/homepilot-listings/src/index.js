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

import { getListingsByCity } from "./db.js";
import { CITY_ALIASES, PUBLIC_CITY_NAMES, HOMEPILOT_CITIES } from "./cities.js";

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

      // ONE-TIME (2026-09-18): verifies the source='PROPTX' fix actually
      // returns zero results for EVERY one of the 49 HOMEPILOT_CITIES,
      // not just the one (Hamilton) manually spot-checked. Queries D1
      // directly (bypassing the /listings HTTP path entirely) for a
      // straight count per city, both with and without the source filter,
      // so any gap shows up as a nonzero "afterFix" count. Read-only.
      if (url.pathname === "/proptx-full-fix-verification") {
        const results = [];
        for (const city of HOMEPILOT_CITIES) {
          const before = await env.DB.prepare(
            "SELECT COUNT(*) as n FROM listings WHERE city = ?"
          ).bind(city).first();
          const after = await env.DB.prepare(
            "SELECT COUNT(*) as n FROM listings WHERE city = ? AND source = 'PROPTX'"
          ).bind(city).first();
          results.push({ city, beforeFixTotalRows: before.n, afterFixVisibleRows: after.n });
        }
        const anyNonZeroAfterFix = results.filter(r => r.afterFixVisibleRows > 0);
        return new Response(JSON.stringify({
          totalCitiesChecked: results.length,
          citiesStillShowingListingsAfterFix: anyNonZeroAfterFix,
          allCityCounts: results,
        }, null, 2), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
      }

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
      // DDF listings to count:0. The 11,121 old rows are left in the
      // table untouched, just no longer reachable via /listings. Both
      // one-time investigation routes used to find this have been
      // removed.

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

        const rawType = url.searchParams.get("type");
        const propertyType = VALID_PROPERTY_TYPES.has(rawType) ? rawType : null;

        const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
        // offset added 2026-07-24 for "Load more" pagination -- lets the
        // front end page through a city's full stored inventory instead of
        // being capped at the first `limit` rows.
        const offsetParam = parseInt(url.searchParams.get("offset") || "0", 10);
        const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

        // budget (added 2026-07-29, affordability-consistency fix): the
        // recommended price the buyer was shown -- see openListingsWindow()
        // in listings-display.js for how the frontend chooses this value.
        // parseFloat + finite + positive check, same defensive pattern as
        // limit/offset above -- an invalid or missing value means no price
        // ceiling at all (matches prior behavior exactly for any caller,
        // old or new, that doesn't pass it).
        const budgetParam = parseFloat(url.searchParams.get("budget"));
        const searchBudget = Number.isFinite(budgetParam) && budgetParam > 0 ? budgetParam : null;

        const listings = await getListingsByCity(env.DB, city, limit, propertyType, offset, searchBudget);
        return new Response(
          JSON.stringify({ city: requestedCity, propertyType: propertyType || "all", offset, searchBudget, count: listings.length, listings }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      return new Response(JSON.stringify({ error: "Not found. Try /listings" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  },

  // Cron trigger handler -- see wrangler.jsonc for the schedule. The DDF
  // runIngest() call was removed here 2026-09-18. Currently a no-op: no
  // ingest pipeline exists until PropTx is wired in, so the cron fires but
  // does nothing. Replace with a PropTx-equivalent ingest call once built.
  async scheduled(event, env, ctx) {},
};
