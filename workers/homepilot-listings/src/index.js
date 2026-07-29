// homepilot-listings — entry point
// Routes requests to /test, /metadata, /ingest, and handles the scheduled
// cron trigger for the daily refresh job (added 2026-07-21). Auth,
// query-building, city list, D1 writes, and ingest logic now live in
// dedicated modules -- see auth.js, cities.js, query.js, db.js, ingest.js
// in this same folder.

import { getAccessToken } from "./auth.js";
import {
  buildQuery, API_BASE, SOURCE_ATTRIBUTION_CANDIDATE_FIELDS, buildFieldProbeQuery,
  INGEST_PROBE_CITIES, buildProbeFilterClauses, buildIngestProbeQuery,
} from "./query.js";
import { runIngest } from "./ingest.js";
import { getListingsByCity } from "./db.js";
import { CITY_ALIASES, PUBLIC_CITY_NAMES } from "./cities.js";

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

      if (url.pathname === "/test") {
        const token = await getAccessToken(env);
        const listingsResp = await fetch(`${API_BASE}/Property?${buildQuery(20, 0).toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const listingsData = await listingsResp.json();
        return new Response(
          JSON.stringify({ status: listingsResp.status, count: (listingsData.value || []).length, listings: listingsData.value || listingsData }, null, 2),
          { status: listingsResp.status, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      if (url.pathname === "/metadata") {
        const token = await getAccessToken(env);
        const metaResp = await fetch(`${API_BASE}/$metadata`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const metaText = await metaResp.text();
        return new Response(metaText, {
          status: metaResp.status,
          headers: { "Content-Type": "application/xml", ...corsHeaders(origin) },
        });
      }

      // /field-probe (added 2026-07-28, DDF observability audit): tests
      // each candidate source-attribution field (see
      // SOURCE_ATTRIBUTION_CANDIDATE_FIELDS in query.js) in its OWN
      // isolated request against real CREA data -- one field per request,
      // $top=1 -- so a bad field name can only fail its own probe, never
      // mask or get masked by another field's result. This is the same
      // isolated-testing method already used and documented in this
      // codebase to root-cause the StandardStatus 400 (see query.js).
      // Read-only, makes no D1 writes, safe to call anytime. This is the
      // ONLY sanctioned way to confirm a new field name before it's added
      // to SELECT_FIELDS for real ingestion -- see the comment on
      // SOURCE_ATTRIBUTION_CANDIDATE_FIELDS for why guessing isn't good
      // enough here (DaysOnMarket and ListOfficeName both looked valid and
      // both weren't).
      if (url.pathname === "/field-probe") {
        const token = await getAccessToken(env);
        const results = [];
        for (const field of SOURCE_ATTRIBUTION_CANDIDATE_FIELDS) {
          try {
            const resp = await fetch(`${API_BASE}/Property?${buildFieldProbeQuery(field).toString()}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await resp.json().catch(() => null);
            results.push({
              field,
              status: resp.status,
              valid: resp.ok,
              // sampleValue lets you see what the field actually returns
              // for a real listing when it IS valid (e.g. is
              // OriginatingSystemName really "TRREB", or something else)
              sampleValue: resp.ok && data && data.value && data.value[0] ? data.value[0][field] ?? null : null,
              error: !resp.ok && data ? (data.error?.message || JSON.stringify(data)) : null,
            });
          } catch (err) {
            results.push({ field, status: null, valid: false, sampleValue: null, error: err.message || String(err) });
          }
        }
        return new Response(
          JSON.stringify({
            probedAt: new Date().toISOString(),
            confirmedValid: results.filter((r) => r.valid).map((r) => r.field),
            confirmedInvalid: results.filter((r) => !r.valid).map((r) => r.field),
            results,
          }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      // /ingest-probe (added 2026-07-28, ingestion scope audit): answers
      // "are missing GTA listings unavailable from CREA, or is our own
      // $filter excluding them?" by running 4 progressively-filtered
      // queries per city -- Test 1 has NONE of our production filters,
      // Test 4 IS exactly our production filter -- and comparing counts.
      // READ-ONLY. Makes zero env.DB calls, zero writes, does not call
      // runIngest(), does not touch production data in any way. Uses
      // $top=5 (sample values only) + $count=true (CREA's real total,
      // if honored for this account) per test -- never pulls full pages.
      if (url.pathname === "/ingest-probe") {
        const token = await getAccessToken(env);
        const citiesParam = url.searchParams.get("cities");
        const cities = citiesParam
          ? citiesParam.split(",").map((c) => c.trim()).filter(Boolean)
          : INGEST_PROBE_CITIES;

        // Runs one isolated CREA request for a given $filter + $select
        // combination. Never throws -- a network/parse failure becomes a
        // {ok:false} result so one bad request can't abort the whole probe.
        async function probeOnce(filterClause, selectFields) {
          try {
            const params = buildIngestProbeQuery(filterClause, selectFields);
            const resp = await fetch(`${API_BASE}/Property?${params.toString()}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await resp.json().catch(() => null);
            return { ok: resp.ok, status: resp.status, data };
          } catch (err) {
            return { ok: false, status: null, data: null, error: err.message || String(err) };
          }
        }

        const results = [];
        for (const city of cities) {
          const clauses = buildProbeFilterClauses(city);
          const tests = {};
          for (const [testName, filterClause] of Object.entries(clauses)) {
            // Two requests per test: PropertySubType + StructureType are
            // already confirmed-valid fields (both live in production
            // SELECT_FIELDS today), fetched together. PropertyType is
            // NOT yet confirmed for this account, so it's isolated into
            // its own request -- if it's an invalid field name, that
            // request fails on its own and doesn't take down
            // PropertySubType/StructureType/the record count with it.
            const primary = await probeOnce(filterClause, ["ListingKey", "PropertySubType", "StructureType"]);
            const propertyTypeProbe = await probeOnce(filterClause, ["ListingKey", "PropertyType"]);

            const values = primary.ok && primary.data && Array.isArray(primary.data.value) ? primary.data.value : [];
            const odataCount = primary.ok && primary.data && typeof primary.data["@odata.count"] === "number"
              ? primary.data["@odata.count"]
              : null;

            const ptValues = propertyTypeProbe.ok && propertyTypeProbe.data && Array.isArray(propertyTypeProbe.data.value)
              ? propertyTypeProbe.data.value
              : [];

            tests[testName] = {
              filter: filterClause,
              creaHttpStatus: primary.status,
              // recordCount is CREA's own reported total for this filter
              // (via $count=true) when honored for this account; null
              // (NOT 0, NOT the sample size) if CREA doesn't return
              // @odata.count -- never guessed or approximated.
              recordCount: odataCount,
              recordCountMethod: odataCount !== null
                ? "$count=true (CREA-reported total)"
                : "unavailable -- CREA did not return @odata.count for this account/query",
              sampleSizeReturned: values.length,
              first5PropertySubType: values.slice(0, 5).map((v) => v.PropertySubType ?? null),
              first5StructureType: values.slice(0, 5).map((v) => v.StructureType ?? null),
              first5PropertyType: propertyTypeProbe.ok ? ptValues.slice(0, 5).map((v) => v.PropertyType ?? null) : null,
              propertyTypeFieldValid: propertyTypeProbe.ok,
              error: !primary.ok ? (primary.data?.error?.message || `HTTP ${primary.status}`) : null,
              propertyTypeError: !propertyTypeProbe.ok
                ? (propertyTypeProbe.data?.error?.message || `HTTP ${propertyTypeProbe.status}`)
                : null,
            };
          }
          results.push({ city, tests });
        }

        return new Response(
          JSON.stringify({ probedAt: new Date().toISOString(), readOnly: true, results }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      if (url.pathname === "/ingest") {
        const result = await runIngest(env);
        return new Response(
          JSON.stringify({ status: "ok", ...result }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
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

      return new Response(JSON.stringify({ error: "Not found. Try /test, /metadata, /field-probe, /ingest-probe, /ingest, or /listings" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  },

  // Cron trigger handler -- see wrangler.jsonc for the schedule. Runs the
  // exact same runIngest() used by the manual /ingest route, so there is
  // only one ingest code path to test and trust.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runIngest(env));
  },
};
