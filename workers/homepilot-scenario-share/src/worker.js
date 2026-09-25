// homepilot-scenario-share
//
// Stores HomePilot "Share Scenario" data server-side in Cloudflare KV so that
// shareable links contain only a short random ID — never the buyer's raw
// income, debt, down payment, or work postal code. Previously this data was
// Base64-encoded directly into the URL, which is NOT encryption and could be
// decoded by anyone who saw the link. Fixed July 2026.
//
// Endpoints:
//   POST /save          body: { inc, dn, dbt, fam, wa, wp, rate } -> { ok, id }
//   GET  /load?id=XXXX  -> the stored scenario object, or { ok:false } on miss
//
// Requires a KV namespace bound as SCENARIO_KV (see DEPLOY_NOTES.md).

const ALLOWED_ORIGINS = [
  "https://myhomepilot.ca",
  "https://www.myhomepilot.ca",
];

const TTL_SECONDS = 60 * 60 * 24 * 180; // links expire after 180 days
const ID_LENGTH = 8;
const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I

// Only these fields are ever accepted or stored. This keeps the endpoint from
// becoming a general-purpose data dump even if the request body contains more.
const ALLOWED_FIELDS = ["inc", "dn", "dbt", "fam", "wa", "wp", "rate"];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) out += ID_CHARS[bytes[i] % ID_CHARS.length];
  return out;
}

function sanitizePayload(raw) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method === "POST" && url.pathname === "/save") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
      }

      const payload = sanitizePayload(body);
      if (Object.keys(payload).length === 0) {
        return jsonResponse({ ok: false, error: "empty_payload" }, 400, origin);
      }

      // Generate an ID, retry on the rare collision (KV is effectively unlimited
      // keyspace at this ID length, but check anyway rather than assume).
      let id = randomId();
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await env.SCENARIO_KV.get(id);
        if (!existing) break;
        id = randomId();
      }

      await env.SCENARIO_KV.put(id, JSON.stringify(payload), {
        expirationTtl: TTL_SECONDS,
      });

      return jsonResponse({ ok: true, id }, 200, origin);
    }

    if (request.method === "GET" && url.pathname === "/load") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9]{4,16}$/.test(id)) {
        return jsonResponse({ ok: false, error: "invalid_id" }, 400, origin);
      }

      const stored = await env.SCENARIO_KV.get(id);
      if (!stored) {
        return jsonResponse({ ok: false, error: "not_found" }, 404, origin);
      }

      // Stored value is already a JSON string of the sanitized payload —
      // return it as-is rather than re-wrapping it.
      return new Response(stored, {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
  },
};