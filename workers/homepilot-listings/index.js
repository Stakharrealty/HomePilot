// HomePilot DDF Listings Worker
// Pulls real MLS listing data from CREA's DDF Web API (RESO Web API / OData standard)
// and will eventually store it for HomePilot to display, replacing the city-average
// price placeholders currently used throughout the app.
//
// STAGE 1 (this file, today): prove the real connection works. GET /test fetches an
// access token and pulls a small number of real listings, returning them raw so we
// can visually confirm the feed is actually live and the credentials are correct —
// before investing time building storage/scheduling around it.
//
// Credentials (env.DDF_CLIENT_ID / env.DDF_CLIENT_SECRET) are the DDF feed's
// username/password, added via `wrangler secret put` — never hardcoded here, never
// visible in this file, matching the pattern used for every other secret today.

const ALLOWED_ORIGIN = "https://myhomepilot.ca";
const TOKEN_URL = "https://identity.crea.ca/connect/token";
const API_BASE = "https://ddfapi.realtor.ca/odata/v1";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Fetch a fresh access token. Tokens last 60 minutes (per CREA docs) - this Worker
// requests a new one on every invocation for now, since Stage 1 is just proving
// connectivity works. Once we move to scheduled ingestion, we can cache the token
// in KV for its lifetime instead of requesting a fresh one every run.
async function getAccessToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.DDF_CLIENT_ID,
      client_secret: env.DDF_CLIENT_SECRET,
      scope: "DDFApi_Read",
    }).toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Token request failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // GET /metadata - fetches CREA's official field definitions, including the
    // complete valid value list for PropertySubType. This tells us the REAL
    // category names to filter on, instead of guessing and risking silently
    // excluding real houses with a wrong guess.
    if (url.pathname === "/metadata") {
      try {
        const token = await getAccessToken(env);
        const metaRes = await fetch(`${API_BASE}/$metadata`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const metaText = await metaRes.text();
        const match = metaText.match(/<EnumType Name="PropertySubType"[\s\S]*?<\/EnumType>/);
        return new Response(JSON.stringify({
          ok: metaRes.ok,
          status: metaRes.status,
          propertySubTypeEnum: match ? match[0] : "Not found via regex - returning first 3000 chars of full metadata instead",
          fullMetadataSnippet: match ? undefined : metaText.slice(0, 3000),
        }, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
    }

    // GET /test - Stage 1 connectivity check. Pulls 3 real Ontario listings and
    // returns them raw. This is the very first real proof the credentials + feed
    // actually work end to end.
    if (url.pathname === "/test") {
      try {
        const token = await getAccessToken(env);

        // Small, cheap query: top 3 active Ontario listings, only the fields we
        // actually care about for now (keeps the response readable for this test).
        const query = new URLSearchParams({
          "$top": "5",
          "$filter": "StateOrProvince eq 'Ontario'",
          "$select": "ListingKey,ListPrice,City,UnparsedAddress,Latitude,Longitude,BedroomsTotal,BathroomsTotalInteger,PropertySubType,CommonInterest,StructureType,ListingURL,ModificationTimestamp",
        });

        const propRes = await fetch(`${API_BASE}/Property?${query.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const propData = await propRes.json();

        return new Response(JSON.stringify({
          ok: propRes.ok,
          status: propRes.status,
          tokenObtained: true,
          listingCount: Array.isArray(propData.value) ? propData.value.length : 0,
          sample: propData,
        }, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      message: "HomePilot Listings Worker - Stage 1 (connectivity test). Try GET /test",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
