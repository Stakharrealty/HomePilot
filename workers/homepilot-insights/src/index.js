var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var ALLOWED_ORIGIN = "https://myhomepilot.ca";
var MODEL = "claude-haiku-4-5-20251001";
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
var index_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return new Response(JSON.stringify({ error: "Missing required field: prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    if (body.prompt.length > 4e3) {
      return new Response(JSON.stringify({ error: "Prompt too long" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    try {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1e3,
          messages: [{ role: "user", content: body.prompt }]
        })
      });
      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text().catch(() => "");
        console.error("Anthropic API error:", anthropicRes.status, errText);
        return new Response(JSON.stringify({ error: "AI insights temporarily unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        });
      }
      const data = await anthropicRes.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    } catch (err) {
      console.error("insights worker error:", err && err.message ? err.message : err);
      return new Response(JSON.stringify({ error: "AI insights temporarily unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
