// homepilot-listings — entry point
// Routes requests to /test, /metadata, /ingest, and handles the scheduled
// cron trigger for the daily refresh job (added 2026-07-21). Auth,
// query-building, city list, D1 writes, and ingest logic now live in
// dedicated modules -- see auth.js, cities.js, query.js, db.js, ingest.js
// in this same folder.

import { getAccessToken } from "./auth.js";
import { buildQuery, API_BASE } from "./query.js";
import { runIngest } from "./ingest.js";

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
        const result = await runIngest(env);
        return new Response(
          JSON.stringify({ status: "ok", ...result }, null, 2),
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

  // Cron trigger handler -- see wrangler.jsonc for the schedule. Runs the
  // exact same runIngest() used by the manual /ingest route, so there is
  // only one ingest code path to test and trust.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runIngest(env));
  },
};
