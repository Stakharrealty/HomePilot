// homepilot-insights — Cloudflare Worker
//
// RECONSTRUCTED July 20, 2026. This is NOT extracted from the live deployment —
// Cloudflare's dashboard does not expose source for Workers deployed via Wrangler
// CLI, and no local copy of this file could be found on Sandeep's computer. This
// version was rewritten from scratch based on:
//   (a) the pre-migration Netlify function this worker replaced (netlify/functions/
//       insights.js, since removed from the repo — it POSTed a {prompt} to
//       https://api.anthropic.com/v1/messages with model claude-haiku-4-5-20251001
//       and forwarded the raw response), and
//   (b) the client-side fetchCityInsights() function in index.html, whose tests
//       (tests/regression_suite.js, suite "AIInsights") mock the fetch response in
//       Anthropic's native shape — {content:[{type:"text",text:"<json>"}]} — and
//       expect fetchCityInsights to parse that directly, confirming this worker's
//       job is to forward the request to Anthropic and return its response
//       essentially unmodified, not to reshape it.
//
// CONFIDENCE: MEDIUM. The overall pattern (proxy to Anthropic, add the API key
// server-side, return response as-is) is well-supported by both sources above.
// The EXACT prompt text sent to Anthropic — including the specific guardrail
// language ("NEVER state an exact commute time", "NEVER make claims about crime",
// etc.) referenced in the regression suite — actually lives in index.html's
// fetchCityInsights() function, which constructs the prompt client-side and sends
// it to this worker. That prompt-construction code is NOT reconstructed here;
// it should already be intact in index.html and does not need rebuilding.
//
// Known request/response contract:
//   POST https://homepilot-insights.stakharrealty.workers.dev  (or similar)
//   Body (JSON): { prompt: "<the full prompt text built by fetchCityInsights>" }
//   Response: Anthropic's native /v1/messages response shape, forwarded as-is,
//             so the client can do JSON.parse(data.content[0].text) to get
//             { whyBuyers, tradeOffs, lifestyleSnapshot }.
//
// Requires: env.ANTHROPIC_API_KEY set via `wrangler secret put`.

const ALLOWED_ORIGINS = ["https://myhomepilot.ca", "https://www.myhomepilot.ca"];
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
    }

    if (!body.prompt) {
      return jsonResponse({ ok: false, error: "missing_prompt" }, 400, origin);
    }

    try {
      const anthropicRes = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": env.ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          messages: [{ role: "user", content: body.prompt }],
        }),
      });

      const data = await anthropicRes.json();

      // Forward Anthropic's response essentially as-is — index.html's
      // fetchCityInsights() expects data.content[0].text to contain the JSON
      // string it then parses for whyBuyers/tradeOffs/lifestyleSnapshot.
      return new Response(JSON.stringify(data), {
        status: anthropicRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return jsonResponse({ ok: false, error: err && err.message ? err.message : "upstream_failed" }, 502, origin);
    }
  },
};
