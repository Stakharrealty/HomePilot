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

import { getListingsByCity, idxCappedLimit, SHOWN_HOMES_CLAUSE, PROPERTY_TYPE_FILTERS } from "./db.js";
import { CITY_ALIASES, PUBLIC_CITY_NAMES, HOMEPILOT_CITIES } from "./cities.js";
import { runSubtypeCensus } from "./proptx-census.js";
import { runAutoIngest, ensureStateTable, AUTO_INGEST_CITIES } from "./proptx-auto-ingest.js";

// PROPTX_DISPLAY_ENABLED (added 2026-09-18): master switch for showing
// PropTx IDX listings to buyers on the public /listings route. Set to
// false because the PROPTX IDX Data Agreement Article 6.3 notices
// ("deemed reliable but not guaranteed accurate by PROPTX" and the
// bona-fide-consumer notice) are not on the listings page yet, and the
// brokerage line is styled smaller/lighter than the other listing
// details. Ingest keeps running -- this only controls what buyers see.
// Flip back to true in the same change that adds the notices.
const PROPTX_DISPLAY_ENABLED = false;


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

      // ONE-TIME (2026-09-18): checks whether `listings` has a UNIQUE
      // constraint/index on listing_key before running any upsert logic
      // against it -- the planned ingest module relies on
      // ON CONFLICT(listing_key), which requires one to exist. Read-only.
      if (url.pathname === "/proptx-check-unique-constraint") {
        const indexes = await env.DB.prepare("PRAGMA index_list(listings)").all();
        const indexDetails = [];
        for (const idx of indexes.results || []) {
          const info = await env.DB.prepare(`PRAGMA index_info(${idx.name})`).all();
          indexDetails.push({ name: idx.name, unique: idx.unique, columns: (info.results || []).map(c => c.name) });
        }
        return new Response(JSON.stringify({ indexes: indexDetails }, null, 2), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      // ONE-TIME (2026-09-18): checks how many rows actually made it into
      // D1 before the /proptx-ingest-test-mississauga run hit Cloudflare's
      // Error 1102 (Worker exceeded resource limits) -- upserts that
      // completed before the timeout are NOT rolled back, so this tells us
      // whether the run made partial progress or failed before writing
      // anything. Read-only.
      if (url.pathname === "/proptx-check-partial-ingest") {
        const count = await env.DB.prepare(
          "SELECT COUNT(*) as n FROM listings WHERE city = 'Mississauga' AND source = 'PROPTX'"
        ).first();
        const sample = await env.DB.prepare(
          "SELECT listing_key, list_price, list_office_name, tax_annual_amount, source FROM listings WHERE city = 'Mississauga' AND source = 'PROPTX' LIMIT 5"
        ).all();
        return new Response(JSON.stringify({
          mississaugaPropTxRowsWritten: count.n,
          sampleRows: sample.results,
        }, null, 2), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
      }

      // TEMPORARY (2026-09-18): read-only census of every PropertySubType
      // label PropTx uses for active residential for-sale listings -- see
      // proptx-census.js. Feeds the home-type sorting and non-home
      // blocking fixes. Never touches D1. Delete with the other /proptx-*
      // test routes.
      if (url.pathname === "/proptx-subtype-census") {
        const census = await runSubtypeCensus(env.PROPTX_IDX_TOKEN);
        return new Response(JSON.stringify(census, null, 2), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      // ONE-TIME (2026-09-18): summarizes what the first real PropTx page
      // actually saved -- transaction type (sale vs lease), property
      // subtype, and how the existing condo/town/semi/detached
      // classification treats these rows. Checks whether leases/commercial
      // slipped in and whether the DDF-era type filters work on PropTx
      // data. Read-only.
      if (url.pathname === "/proptx-first-page-summary") {
        const total = await env.DB.prepare("SELECT COUNT(*) as n FROM listings WHERE source='PROPTX'").first();
        const byTxn = await env.DB.prepare("SELECT transaction_type, COUNT(*) as n FROM listings WHERE source='PROPTX' GROUP BY transaction_type").all();
        const bySub = await env.DB.prepare("SELECT property_subtype, COUNT(*) as n FROM listings WHERE source='PROPTX' GROUP BY property_subtype").all();
        const visible = await getListingsByCity(env.DB, "Mississauga", 50, null, 0, null);
        const typeCounts = {};
        for (const l of (visible.listings || visible || [])) {
          typeCounts[l.propertyType] = (typeCounts[l.propertyType] || 0) + 1;
        }
        const samples = await env.DB.prepare("SELECT listing_key, list_price, transaction_type, property_subtype, structure_type, list_office_name, tax_annual_amount, association_fee, latitude, longitude FROM listings WHERE source='PROPTX' LIMIT 25").all();
        return new Response(JSON.stringify({
          totalPropTxRows: total.n,
          byTransactionType: byTxn.results,
          byPropertySubtype: bySub.results,
          howSiteClassifiesThem: typeCounts,
          rows: samples.results,
        }, null, 2), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
      }

      // Read-only progress check for the automatic PropTx ingest (see
      // proptx-auto-ingest.js). Replaces the old manual
      // /proptx-ingest-test-mississauga route (removed 2026-09-18 -- the
      // cron now does that work). Temporary; remove with the other
      // /proptx-* routes once ingest is settled.
      if (url.pathname === "/proptx-ingest-status") {
        await ensureStateTable(env.DB);
        const states = await env.DB.prepare("SELECT * FROM proptx_ingest_state ORDER BY city").all();
        const cities = [];
        for (const city of AUTO_INGEST_CITIES) {
          const q = (where) => env.DB.prepare(
            `SELECT COUNT(*) AS n FROM listings WHERE city = ? AND source = 'PROPTX' AND transaction_type = 'For Sale' AND ${where}`
          ).bind(city).first();
          const homes = await q(SHOWN_HOMES_CLAUSE);
          const nonHomesStillInDb = await q(`NOT (${SHOWN_HOMES_CLAUSE})`);
          const byButton = {};
          for (const [button, clause] of Object.entries(PROPERTY_TYPE_FILTERS)) {
            byButton[button] = (await q(`${SHOWN_HOMES_CLAUSE} AND ${clause}`)).n;
          }
          cities.push({ city, homesInDb: homes.n, byButton, nonHomesStillInDb: nonHomesStillInDb.n });
        }
        return new Response(JSON.stringify({ progress: states.results || [], database: cities }, null, 2), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

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

        // PROPTX_DISPLAY_ENABLED gate (added 2026-09-18) -- see its
        // definition at the top of this file. While false, buyers get the
        // normal empty state for every city.
        const listings = PROPTX_DISPLAY_ENABLED && cappedLimit > 0
          ? await getListingsByCity(env.DB, city, cappedLimit, propertyType, offset, searchBudget)
          : [];
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

  // Cron trigger handler -- see wrangler.jsonc for the schedule (every 2
  // minutes). Each firing does one bounded unit of the automatic PropTx
  // ingest (proptx-auto-ingest.js): a few pages, cursor saved, then stop.
  // When a city is done and fresh, a firing costs one D1 read.
  async scheduled(event, env, ctx) {
    if (!env.PROPTX_IDX_TOKEN) return;
    ctx.waitUntil(runAutoIngest(env.DB, env.PROPTX_IDX_TOKEN));
  },
};
