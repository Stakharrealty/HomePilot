// homepilot-scenario-share — Cloudflare Worker
//
// RECONSTRUCTED July 20, 2026. This is NOT extracted from the live deployment —
// Cloudflare's dashboard does not expose source for Workers deployed via Wrangler
// CLI, and no local copy of this file could be found on Sandeep's computer. This
// version was rewritten from scratch to match the worker's real, observed
// behavior, which was tested live against the actual deployed endpoint earlier in
// this same session (July 19, 2026):
//
//   POST /save  body {inc,dn,dbt,fam,wa,wp,rate}       -> 200 {"ok":true,"id":"XXXXXXXX"}
//   GET  /load?id=XXXXXXXX (existing id)                -> 200 {inc,dn,dbt,fam,wa,wp,rate}
//   GET  /load?id=doesNotExist                          -> 200 {"ok":false,"error":"not_found"}
//
// CONFIDENCE: HIGH on the request/response contract above (directly observed via
// live fetch calls against the real worker). MEDIUM on internal implementation
// details below (ID generation approach, exact TTL handling, CORS origin list) —
// these follow patterns established elsewhere in the HomePilot codebase and the
// project's documented decisions, but were not directly observed byte-for-byte.
//
// Fixes Bug 2 (Base64 financial data in shareable URLs): index.html's
// shareScenario() calls POST /save and builds links as myhomepilot.ca?s=<id>
// instead of encoding raw buyer data into the URL. loadScenarioFromURL() calls
// GET /load?id= instead of atob()-decoding the URL.
//
// KV binding required: SCENARIO_KV (namespace ID 61b15a9ce07d4f2c959271361be82669
// per project notes)

const ALLOWED_ORIGINS = ["https://myhomepilot.ca", "https://www.myhomepilot.ca"];
const TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days, per project notes

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// Short random ID — 8 alphanumeric characters, matching the observed live format
// (e.g. "JmWQZCRN"). Not cryptographically sensitive; these IDs are meant to be
// short and shareable, not secret — the actual financial data lives in KV, not
// in the ID itself.
function generateId(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/save" && request.method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch (err) {
        return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
      }

      // Basic sanity check on payload size/shape — reject anything wildly
      // malformed before it goes into KV.
      const allowedKeys = ["inc", "dn", "dbt", "fam", "wa", "wp", "rate"];
      const cleaned = {};
      for (const key of allowedKeys) {
        if (key in payload) cleaned[key] = payload[key];
      }
      if (Object.keys(cleaned).length === 0) {
        return jsonResponse({ ok: false, error: "empty_payload" }, 400, origin);
      }

      const id = generateId();
      try {
        await env.SCENARIO_KV.put(id, JSON.stringify(cleaned), {
          expirationTtl: TTL_SECONDS,
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "kv_write_failed" }, 502, origin);
      }

      return jsonResponse({ ok: true, id }, 200, origin);
    }

    if (url.pathname === "/load" && request.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ ok: false, error: "missing_id" }, 400, origin);
      }

      const stored = await env.SCENARIO_KV.get(id);
      if (!stored) {
        return jsonResponse({ ok: false, error: "not_found" }, 200, origin);
      }

      let data;
      try {
        data = JSON.parse(stored);
      } catch (err) {
        return jsonResponse({ ok: false, error: "corrupt_data" }, 500, origin);
      }

      // Live-observed response returns the scenario fields directly (not wrapped
      // in an {ok:true, data:{...}} envelope) — matching that exactly here.
      return jsonResponse(data, 200, origin);
    }

    return jsonResponse({ ok: true, message: "homepilot-scenario-share. POST /save or GET /load?id=" }, 200, origin);
  },
};
