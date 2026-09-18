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

      // TEMPORARY (2026-09-18): read-only PropTx coverage check. For each
      // of HomePilot's 49 tracked cities, gets an active-listing COUNT
      // ONLY from PropTx ($count=true&$top=0 -- no listing content is
      // fetched, stored, or displayed). Batches cities in groups of 12 per
      // request to stay well under PropTx/AMPRE's OData node limit on
      // chained 'or' filters (CREA DDF hit the same kind of limit above
      // ~15-20 chained clauses). Delete this route once the real ingest
      // module is built and coverage is confirmed.
      if (url.pathname === "/proptx-coverage-check") {
        if (!env.PROPTX_IDX_TOKEN) {
          return new Response(JSON.stringify({ error: "PROPTX_IDX_TOKEN secret not found on this Worker" }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        const BATCH_SIZE = 12;
        const results = {};
        const errors = [];
        for (let i = 0; i < HOMEPILOT_CITIES.length; i += BATCH_SIZE) {
          const batch = HOMEPILOT_CITIES.slice(i, i + BATCH_SIZE);
          for (const city of batch) {
            // Escape single quotes for OData string literal safety.
            const safeCity = city.replace(/'/g, "''");
            const filter = encodeURIComponent(`City eq '${safeCity}' and StandardStatus eq 'Active'`);
            const queryUrl = `https://query.ampre.ca/odata/Property?$filter=${filter}&$count=true&$top=0`;
            try {
              const resp = await fetch(queryUrl, {
                headers: {
                  Authorization: `Bearer ${env.PROPTX_IDX_TOKEN}`,
                  Accept: "application/json",
                },
              });
              if (!resp.ok) {
                const errText = await resp.text();
                errors.push({ city, status: resp.status, error: errText.slice(0, 300) });
                results[city] = null;
                continue;
              }
              const data = await resp.json();
              results[city] = data["@odata.count"] ?? null;
            } catch (e) {
              errors.push({ city, error: String(e) });
              results[city] = null;
            }
          }
        }
        return new Response(JSON.stringify({ cityCounts: results, errors, totalCitiesChecked: HOMEPILOT_CITIES.length }, null, 2), {
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }

      // TEMPORARY (2026-09-18): investigate why Toronto (and 5 other
      // cities) returned 0 from /proptx-coverage-check. Pulls a small
      // sample (5 rows, City-ish fields only, no price/address/agent
      // content) of Active listings using a StartsWith on PostalCode 'M'
      // (Toronto's postal prefix) to see what value PropTx actually puts
      // in the City field for Toronto listings. Delete once resolved.
      if (url.pathname === "/proptx-toronto-check") {
        if (!env.PROPTX_IDX_TOKEN) {
          return new Response(JSON.stringify({ error: "PROPTX_IDX_TOKEN secret not found on this Worker" }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          });
        }
        const headers = {
          Authorization: `Bearer ${env.PROPTX_IDX_TOKEN}`,
          Accept: "application/json",
        };

        // 1) Province-wide active count, no city filter at all.
        const totalUrl = `https://query.ampre.ca/odata/Property?$filter=${encodeURIComponent("StandardStatus eq 'Active'")}&$count=true&$top=0`;
        const totalResp = await fetch(totalUrl, { headers });
        const totalData = totalResp.ok ? await totalResp.json() : null;

        // 2) Sample 5 Active listings whose postal code starts with 'M'
        // (Toronto-area prefix), pulling only City/CityRegion/PostalCode/
        // OriginatingSystemName -- no price, address, or agent content.
        const sampleFilter = encodeURIComponent("StandardStatus eq 'Active' and startswith(PostalCode,'M')");
        const sampleSelect = encodeURIComponent("City,CityRegion,PostalCode,OriginatingSystemName,StandardStatus");
        const sampleUrl = `https://query.ampre.ca/odata/Property?$filter=${sampleFilter}&$select=${sampleSelect}&$top=5`;
        const sampleResp = await fetch(sampleUrl, { headers });
        const sampleData = sampleResp.ok ? await sampleResp.json() : { error: await sampleResp.text() };

        // 3) Distinct City values actually seen among 'M'-prefix postal
        // codes, to catch spelling/casing/format differences directly.
        const distinctFilter = encodeURIComponent("StandardStatus eq 'Active' and startswith(PostalCode,'M')");
        const distinctSelect = encodeURIComponent("City");
        const distinctUrl = `https://query.ampre.ca/odata/Property?$filter=${distinctFilter}&$select=${distinctSelect}&$top=50`;
        const distinctResp = await fetch(distinctUrl, { headers });
        const distinctData = distinctResp.ok ? await distinctResp.json() : { error: await distinctResp.text() };
        const distinctCities = distinctData.value
          ? [...new Set(distinctData.value.map(r => r.City))]
          : null;

        return new Response(JSON.stringify({
          provinceWideActiveCount: totalData ? totalData["@odata.count"] : null,
          sampleTorontoAreaListings: sampleData.value || sampleData,
          distinctCityValuesForMPostalCodes: distinctCities,
        }, null, 2), { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
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
