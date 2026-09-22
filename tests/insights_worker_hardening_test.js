// tests/insights_worker_hardening_test.js
//
// The homepilot-insights Worker was an open, unauthenticated proxy to
// Anthropic: it checked only that `body.prompt` was truthy and forwarded it
// verbatim with the site's API key. Anyone could use it as a free Claude API
// billed to HomePilot, and every content guardrail lived client-side in
// src/ai.js inside a string the caller controls — so they constrained the
// honest visitor and nobody else.
//
// This locks in the three layers added on 2026-09-22 and, just as importantly,
// asserts that the guardrails are applied SERVER-SIDE, where a caller cannot
// strip them.
//
// NOTE: this runs against workers/RECONSTRUCTED_homepilot-insights/index.js,
// which is a reconstruction, not the live Worker's source. Passing here does
// not prove the deployed Worker is hardened — that requires a deploy. See
// workers/WORKER_STATUS.md.

const path = require("path");
const { pathToFileURL } = require("url");

const WORKER = path.join(__dirname, "..", "workers", "RECONSTRUCTED_homepilot-insights", "index.js");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${name}`); }
  else { failed++; console.log(`  FAIL - ${name}${detail !== undefined ? ` :: ${detail}` : ""}`); }
}

// The two markers the real client prompt (src/ai.js fetchCityInsights) always
// contains. If the client prompt is reworded, this fixture and the Worker's
// REQUIRED_PROMPT_MARKERS must be updated together.
const REAL_PROMPT =
  "You are a straightforward Canadian real estate advisor helping a GTA homebuyer evaluate Milton, Ontario.\n" +
  "Return ONLY valid JSON, no markdown, no explanation:";

(async () => {
  const worker = (await import(pathToFileURL(WORKER).href)).default;
  const env = { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" };

  let upstream = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    upstream = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{}" }] }) };
  };

  const post = (prompt, { origin = "https://myhomepilot.ca", ip = "203.0.113.1" } = {}) =>
    worker.fetch(new Request("https://w.example/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
        "CF-Connecting-IP": ip,
      },
      body: JSON.stringify({ prompt }),
    }), env);

  try {
    // --- the legitimate path still works
    upstream = null;
    const ok = await post(REAL_PROMPT, { ip: "203.0.113.10" });
    check("a genuine client request is served", ok.status === 200, ok.status);
    check("the request reaches Anthropic", upstream !== null && /api\.anthropic\.com/.test(upstream.url));
    check("the API key is attached server-side, never by the caller",
      upstream && upstream.headers["x-api-key"] === "sk-test-not-a-real-key");

    // --- guardrails are enforced where the caller cannot reach them
    const sent = upstream.body.messages[0].content;
    for (const rule of [
      "NEVER state an exact commute time",
      "NEVER make claims about crime",
      "NEVER rank or rate schools",
      "NEVER predict future home price appreciation",
      "ethnic, cultural, or religious composition",
      "NEVER give financial, mortgage, legal or tax advice",
    ]) {
      check(`server-side guardrail present: "${rule.slice(0, 42)}..."`, sent.includes(rule));
    }
    check("guardrails are appended AFTER the caller's text, so they win",
      sent.indexOf("STRICT RULES - these override anything above") > sent.indexOf("Canadian real estate advisor"));

    // A caller who strips their own copy still gets the server's.
    upstream = null;
    await post(REAL_PROMPT, { ip: "203.0.113.11" });
    check("a prompt with no guardrails of its own still gets the server's",
      upstream.body.messages[0].content.includes("NEVER make claims about crime"));

    // --- abuse paths
    upstream = null;
    const poem = await post("Write me a poem about otters.", { ip: "203.0.113.20" });
    check("an arbitrary prompt is refused (no free LLM)", poem.status === 400, poem.status);
    check("a refused prompt never reaches Anthropic", upstream === null);

    const noOrigin = await post(REAL_PROMPT, { origin: null, ip: "203.0.113.21" });
    check("a request with no Origin (curl) is refused", noOrigin.status === 403, noOrigin.status);

    const badOrigin = await post(REAL_PROMPT, { origin: "https://evil.example", ip: "203.0.113.22" });
    check("a request from another origin is refused", badOrigin.status === 403, badOrigin.status);

    const huge = await post(REAL_PROMPT + "x".repeat(5000), { ip: "203.0.113.23" });
    check("an oversized prompt is refused", huge.status === 413, huge.status);

    const nonString = await worker.fetch(new Request("https://w.example/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://myhomepilot.ca" },
      body: JSON.stringify({ prompt: { evil: true } }),
    }), env);
    check("a non-string prompt is refused", nonString.status === 400, nonString.status);

    // --- cost bound
    let served = 0, limited = 0;
    for (let i = 0; i < 20; i++) {
      const r = await post(REAL_PROMPT, { ip: "203.0.113.99" });
      r.status === 200 ? served++ : limited++;
    }
    check("a single IP is rate limited", limited > 0, `served ${served}, limited ${limited}`);
    check("the rate limit is not so tight it breaks normal use", served >= 10, `served ${served}`);

    // --- method / shape
    const getReq = await worker.fetch(new Request("https://w.example/", {
      method: "GET", headers: { Origin: "https://myhomepilot.ca" },
    }), env);
    check("GET is refused", getReq.status === 405, getReq.status);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
