# Worker Source Status

This file exists so nobody — including a future version of Claude, or Sandeep
six months from now — mistakes reconstructed code for the real thing. Read this
before trusting or deploying anything in `workers/`.

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

---

## homepilot-scenario-share — RECONSTRUCTED (HIGH confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Cloudflare's dashboard does not expose source for Workers deployed via
Wrangler CLI, and no local copy existed on Sandeep's computer. This file was
written from scratch on July 20, 2026.

- Live at: `homepilot-scenario-share.stakharrealty.workers.dev`
- Purpose: fixes the "Base64 financial data in share URLs" bug. Stores
  scenario data (income, down payment, etc.) in KV, returns a short random ID
  instead of encoding raw data into the URL.

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

## homepilot-send-lead — RECONSTRUCTED (MEDIUM confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Same reason as above — Wrangler-deployed, no dashboard source, no local
copy found. Written from scratch on July 20, 2026.

- Live at: `homepilot-send-lead.stakharrealty.workers.dev`
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
guess following Cloudflare's standard pattern, not a verified match.

---

## homepilot-insights — RECONSTRUCTED (MEDIUM confidence)

**Status: rewritten by Claude, not extracted from the live deployment.**
Same reason as above. Written from scratch on July 20, 2026, based on (a)
the pre-migration Netlify function this Worker replaced, and (b) what the
client code in `index.html` expects back.

- Live at: `homepilot-insights.stakharrealty.workers.dev`
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
details are a reasonable guess, not a verified match.

---

## If you're reading this before redeploying any of these Workers

Do not run `wrangler deploy` on the reconstructed files (`scenario-share`,
`send-lead`, `insights`) assuming they'll behave identically to what's
currently live. Test in a way that doesn't affect production first — e.g.
deploy under a different Worker name and compare behavior, or at minimum
re-run the relevant regression suite tests against the new deployment
before pointing real traffic at it.
