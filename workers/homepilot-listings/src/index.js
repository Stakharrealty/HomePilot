// homepilot-listings — entry point
// Routes requests to /test, /metadata, /ingest. Auth, query-building, city
// list, and D1 writes now live in dedicated modules (2026-07-21 split) --
// see auth.js, cities.js, query.js, db.js in this same folder.

import { getAccessToken } from "./auth.js";
import { buildQuery, API_BASE } from "./query.js";
import { upsertListing } from "./db.js";

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

      if (url.pathname === "/ingest") {
        const token = await getAccessToken(env);
        let skip = 0;
        const pageSize = 50;
        const maxRecords = 500;
        let totalWritten = 0;
        let totalSeen = 0;

        while (totalSeen < maxRecords) {
          const resp = await fetch(`${API_BASE}/Property?${buildQuery(pageSize, skip).toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await resp.json();
          const rows = data.value || [];
          if (rows.length === 0) break;

          for (const r of rows) {
            await upsertListing(env.DB, r);
            totalWritten++;
          }

          totalSeen += rows.length;
          skip += pageSize;
          if (rows.length < pageSize) break;
        }

        return new Response(
          JSON.stringify({ status: "ok", totalWritten }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      return new Response(JSON.stringify({ error: "Not found. Try /test, /metadata, or /ingest" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  },
};
