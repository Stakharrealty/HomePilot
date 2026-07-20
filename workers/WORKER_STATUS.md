# Worker Source Status

This file exists so nobody — including a future version of Claude, or Sandeep
six months from now — mistakes reconstructed code for the real thing. Read this
before trusting or deploying anything in `workers/`.

**Update, July 20, 2026:** the three reconstructed Worker folders were renamed
with a `RECONSTRUCTED_` prefix, and each `wrangler.jsonc`'s `name` field was
changed to end in `-RECONSTRUCTED`. This was a real gap caught by an external
audit (Gemini): the original reconstructed files used the *same Worker name*
as the real live Workers, meaning an accidental `wrangler deploy` from inside
one of those folders would have silently overwritten the actual production
Worker. With the name changed, an accidental deploy now creates a new,
separate, harmless Worker instead.

---

## homepilot-listings — VERIFIED ORIGINAL SOURCE

**Status: the real file.** Uploaded directly from Sandeep's own computer,
found alongside its `wrangler.jsonc` in his local project files.

- Live at: `homepilot-listings.stakharrealty.workers.dev`
- Purpose: Stage 1 connectivity test for the CREA DDF (MLS listings) feed.
  Exposes `/test` and `/metadata` endpoints to prove the DDF credentials and
  API connection work, ahead of building real listing storage/display.
- Confidence: **100% — this is the actual deployed code**, not a
  reconstruction.
- Folder name is unchanged (`workers/homepilot-listings/`) since this is
  real source — safe to deploy as-is if ever needed.

---

## workers/RECONSTRUCTED_homepilot-scenario-share — RECONSTRUCTED (HIGH confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Cloudflare's dashboard does not expose source for Workers deployed via
Wrangler CLI, and no local copy existed on Sandeep's computer. This file was
written from scratch on July 20, 2026.

- The REAL live Worker is at: `homepilot-scenario-share.stakharrealty.workers.dev`
- This reconstruction's `wrangler.jsonc` deploys as `homepilot-scenario-share-RECONSTRUCTED`
  — a different, separate Worker — specifically so it can never be
  accidentally deployed over the real one.
- Purpose: fixes the "Base64 financial data in share URLs" bug. Stores
  scenario data (income, down payment, etc.) in KV, returns a short random ID
  instead of encoding raw data into the URL.

**⚠️ Important caveat not fully solved by the rename:** this file's
`kv_namespaces` binding still points at the REAL production `SCENARIO_KV`
namespace (same data real buyers' shared scenarios live in). The Worker
*identity* is now safe to accidentally deploy — but if the deployed
reconstruction is actually invoked (someone calls its `/save` or `/load`
endpoints), it would read/write real production data. Don't test this one
live against real traffic; point it at a separate test KV namespace first
if you need to actually run it.

**What is actually known (verified):**
The exact request/response contract was tested live against the real
deployed Worker on July 19, 2026, before this file was written:
- `POST /save` with `{inc, dn, dbt, fam, wa, wp, rate}` → `{"ok":true,"id":"XXXXXXXX"}`
  (8-character alphanumeric ID, confirmed via a real test call)
- `GET /load?id=<real id>` → the stored fields, returned directly
- `GET /load?id=<nonexistent id>` → `{"ok":false,"error":"not_found"}` (confirmed)

**What is NOT verified (reconstructed guesses):**
- The exact ID-generation algorithm (character set, randomness source)
- The exact CORS origin list and header values
- Whether the KV TTL is really 180 days, or some other value (180 days is
  what's documented in project notes, not independently re-verified here)
- Any internal error-handling paths not covered by the two test calls above

**Bottom line:** the *outside behavior* (what you send, what you get back)
is confirmed accurate. The *inside implementation* is a reasonable rewrite
that should behave the same way, but has not been diffed against the real
deployed bytes.

---

## workers/RECONSTRUCTED_homepilot-send-lead — RECONSTRUCTED (MEDIUM confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Same reason as above — Wrangler-deployed, no dashboard source, no local
copy found. Written from scratch on July 20, 2026.

- The REAL live Worker is at: `homepilot-send-lead.stakharrealty.workers.dev`
- This reconstruction's `wrangler.jsonc` deploys as `homepilot-send-lead-RECONSTRUCTED`
  — a different, separate Worker — so it cannot overwrite the real one.
- Purpose: sends an email to Sandeep whenever a buyer submits the lead form,
  using Cloudflare's Email Sending binding.

**What is actually known (verified):**
The request contract is locked in by `tests/regression_suite.js` (suite
`LeadDelivery&Breakdown`), which asserts against the real client-side code
in `index.html`:
- URL: `https://homepilot-send-lead.stakharrealty.workers.dev`
- Method: `POST`, JSON body with fields `name, email, phone, status,
  timeline, income, downPayment, debt, workCity, mortgageRatePct,
  topMatches, workArrangement, firstTimeBuyer`
- The client checks BOTH the HTTP status and an `{"ok":true/false}` field
  in the response before showing a success message (this was the fix for
  "Bug 1" — silent lead failure)

**What is NOT verified (reconstructed guesses):**
- The actual email-sending implementation (this file uses the standard
  `mimetext` + `EmailMessage` pattern, which is the documented Cloudflare
  approach, but the real file may differ)
- Exact email subject line, formatting, or body layout
- Whether `destination_address` is set in the binding or left open (project
  notes mention it was removed at some point after causing delivery errors
  — this file assumes it's left unset, but that is not independently
  confirmed)

**Bottom line:** what the client sends and expects back is confirmed. How
the email actually gets built and sent inside the Worker is a best-effort
guess following Cloudflare's standard pattern, not a verified match. This
Worker does not use any KV or database binding, so unlike scenario-share,
accidentally invoking this reconstruction would at worst send a stray test
email — not corrupt any stored production data.

---

## workers/RECONSTRUCTED_homepilot-insights — RECONSTRUCTED (MEDIUM confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Same reason as above. Written from scratch on July 20, 2026, based on (a)
the pre-migration Netlify function this Worker replaced, and (b) what the
client code in `index.html` expects back.

- The REAL live Worker is at: `homepilot-insights.stakharrealty.workers.dev`
- This reconstruction's `wrangler.jsonc` deploys as `homepilot-insights-RECONSTRUCTED`
  — a different, separate Worker — so it cannot overwrite the real one.
- Purpose: proxies a prompt to Anthropic's API (adding the API key
  server-side) and returns the AI-generated city insights.

**What is actually known (verified):**
- `tests/regression_suite.js` (suite `AIInsights`) confirms the CLIENT side
  expects a response shaped like Anthropic's native API response —
  `{content:[{type:"text", text:"<json string>"}]}` — which the client then
  parses for `whyBuyers`, `tradeOffs`, `lifestyleSnapshot`.
- The pre-migration Netlify function (now deleted from the repo, but seen
  in earlier project history) posted to `https://api.anthropic.com/v1/messages`
  with model `claude-haiku-4-5-20251001` and forwarded the raw response —
  this file follows that same pattern.

**What is NOT verified (reconstructed guesses):**
- Whether the live Worker still uses `claude-haiku-4-5-20251001` or a
  different/newer model
- The exact prompt text and guardrail language ("NEVER state an exact
  commute time," etc.) — **this actually lives in `index.html`'s
  `fetchCityInsights()` function, which builds the prompt client-side and
  sends it to this Worker.** That prompt-construction code should already
  be intact in `index.html` and does not need reconstruction here.
- Any request validation or error-handling details beyond the basics

**Bottom line:** the overall shape (proxy to Anthropic, return response
as-is) is well-supported by two independent sources. Exact implementation
details are a reasonable guess, not a verified match. This Worker holds no
persistent data of its own (no KV/DB), so accidentally invoking it would at
worst make a stray real call to Anthropic's API using the real API key, if
that secret were also set on the -RECONSTRUCTED Worker (it won't be unless
someone deliberately configures it).

---

## If you're reading this before redeploying any of these Workers

The name changes above make it much harder to accidentally overwrite live
production Workers — but they do NOT fully isolate data (see the KV caveat
under scenario-share). Don't invoke any reconstructed Worker's real
endpoints against production data as a way of "testing" it. If you need to
verify a reconstruction actually works, point its bindings at separate
test resources first.
