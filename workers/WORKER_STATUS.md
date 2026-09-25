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

**Update, September 24, 2026:** the live code of all three was downloaded
from Cloudflare (read-only) into `workers/homepilot-insights/`,
`workers/homepilot-send-lead/` and `workers/homepilot-scenario-share/`. Those
folders are what is actually running; see their sections below. The
`RECONSTRUCTED_` folders and sections are kept as history; where they disagree
with the live code, the live code wins. Their `wrangler.jsonc` files carry the
real Worker names, so `wrangler deploy` from those folders deploys to
production (unchanged, that re-uploads the same code). The claim further down
that Cloudflare "does not expose source for Workers deployed via Wrangler CLI"
was wrong: `npx wrangler init --from-dash <worker-name> --no-delegate-c3`, run
from a folder outside the repo, downloads the deployed script plus a generated
`wrangler.jsonc`. Secret values are never included, but plain-text vars would
be, so scan before committing.

---

## homepilot-listings — VERIFIED ORIGINAL SOURCE

**Status: the real file.** Uploaded directly from Sandeep's own computer,
found alongside its `wrangler.jsonc` in his local project files.

- Live at: `homepilot-listings.stakharrealty.workers.dev`
- Purpose (**description corrected 2026-09-22, audit** — this said "Stage 1
  connectivity test for the CREA DDF feed, exposes `/test` and `/metadata`",
  which has been wrong since the PropTx migration): the production listings
  API and ingest pipeline. Serves `/listings` and `/listing?key=` from a D1
  database, and runs a cron every 2 minutes that pages the PropTx IDX feed
  into that database from a saved cursor. Has its own migrations
  (`migrations/0001`–`0005`) and its own deploy workflow
  (`.github/workflows/deploy-listings.yml`).
- Requires the `PROPTX_IDX_TOKEN` secret. Without it the cron returns
  immediately and nothing is ever ingested, with no error anywhere.
- Confidence: **100% — this is the actual deployed code**, not a
  reconstruction.
- Folder name is unchanged (`workers/homepilot-listings/`) since this is
  real source — safe to deploy as-is if ever needed.

---

## homepilot-insights — LIVE CODE (downloaded 2026-09-24)

**Downloaded from Cloudflare on 2026-09-24 with `wrangler init --from-dash`;
this is the live code.** Folder: `workers/homepilot-insights/` (`src/index.js`,
`wrangler.jsonc`), byte-for-byte as downloaded. Active version at download:
`7f70a44f` (a secret change on 2026-07-16 over that day's upload `1e471aa3`).
`src/index.js` is the bundled file Wrangler uploaded; the unbundled original
was never in git, so its comments are gone.

- Endpoint: `POST` to any path with `{prompt}`. `OPTIONS` answers CORS; other
  methods get 405.
- Validation: `prompt` must be a non-empty string of at most 4,000
  characters, otherwise 400. Nothing checks what the prompt asks for.
- Sends the prompt to Anthropic unchanged, as the only message, with model
  `claude-haiku-4-5-20251001` and `max_tokens` 1000 (both fixed in the Worker;
  a caller cannot change them). Returns Anthropic's JSON on success; any
  upstream error becomes a 502 `{"error":"AI insights temporarily unavailable"}`.
- Origin: only a CORS header (`https://myhomepilot.ca`, otherwise `"null"`).
  Requests from any other origin, or with no Origin at all (curl), are served.
  `www.myhomepilot.ca` is not in the CORS header.
- No server-side content rules, no prompt-shape check, no rate limit.
- Stores nothing (no KV, no database). Logs Anthropic's error text with
  `console.error`; Workers Logs are not enabled in its config.
- Expects secret `ANTHROPIC_API_KEY` (set on Cloudflare; checked by name only
  with `wrangler secret list`). No other bindings. `workers_dev` on,
  `preview_urls` on, compatibility date 2025-01-01.
- **Differs from the RECONSTRUCTED copy:** the reconstruction has all the
  hardening this code lacks: an enforced origin allow-list (403), two required
  prompt phrases, content rules appended after the caller's text, a per-IP
  limit (12 an hour, per isolate) and 413 for long prompts. Model and
  `max_tokens` are the same.
- **The hardening test does not test this code.**
  `tests/insights_worker_hardening_test.js` (run by `deploy.yml` and
  `dev-to-main.yml`) imports only `workers/RECONSTRUCTED_homepilot-insights/index.js`.
  Run against this live file it fails 14 of 20 checks: every content-rule,
  origin, prompt-shape and rate-limit check (the long-prompt check fails only
  on the status, 400 instead of 413). A green run says nothing about
  production. The "ACTION REQUIRED" section below still stands: the live
  Worker is an open Anthropic proxy billed to HomePilot.
- Preview URLs are on. Before relying on a hardened redeploy, turn
  `preview_urls` off or confirm older versions cannot be reached at their own
  preview URLs.

---

## homepilot-send-lead — LIVE CODE (downloaded 2026-09-24)

**Downloaded from Cloudflare on 2026-09-24 with `wrangler init --from-dash`;
this is the live code.** Folder: `workers/homepilot-send-lead/` (`src/index.js`,
`wrangler.jsonc`), byte-for-byte as downloaded. Active version at download:
`e6bd64d6` (2026-07-16). Bundled file, like insights. The site stopped calling
it when the lead form was removed on 2026-09-23, but it is still live and
still sends email.

- Endpoint: `POST` to any path with a JSON lead. Only `name` and `email` are
  required (any non-empty value). No format, type or length checks.
- Where the data goes: an HTML email (values HTML-escaped) sent through the
  `SEND_EMAIL` binding's `send({to, from, subject, html, replyTo})` to
  `stakharrealty@gmail.com`, from `leads@myhomepilot.ca`, subject
  `New HomePilot Lead: <name>`, reply-to set to the lead's email. The email
  carries name, email, phone, renting/own, timeline, income, down payment,
  monthly debt, family size, first-time buyer, mortgage rate, work city, work
  arrangement, and the matched cities with type, price and monthly cost.
- Stores nothing itself: no KV, no database, no webhook, no Zapier. The only
  copy is the email, kept as long as it stays in that inbox. Error logs hold
  only the error message; Workers Logs are not enabled in its config.
- Origin: only a CORS header (`https://myhomepilot.ca`, otherwise `"null"`).
  Any caller, curl included, can make it send an email. No rate limit, so it
  can fill that inbox with any text and any reply-to address.
- A failed send returns 502 with a `debug` field holding the internal error
  message.
- The field names did not match the form: the Worker reads `debt` and
  `mortgageRate`, the form sent `existingMonthlyDebt` and `mortgageRatePct`
  (in git since 2026-07-18), so "Monthly debt" and "Mortgage rate used" were
  blank in every lead email since then. Other fields the form sent (partner
  income, both buying powers, residency, rebate eligibility, language) were
  ignored.
- Bindings/secrets: `SEND_EMAIL` (`send_email`) with no `destination_address`,
  `allowed_destination_addresses` or `allowed_sender_addresses` set, which
  answers the `destination_address` TODO in `SECRETS.md`. No secrets.
  `workers_dev` on, `preview_urls` on, compatibility date 2025-01-01.
- **Differs from the RECONSTRUCTED copy:** the reconstruction builds a
  plain-text email with `EmailMessage` and mimetext; the live code passes an
  object with HTML to `send()`, sets reply-to, returns `debug` on failure,
  reads `mortgageRate` and `familySize` (the reconstruction reads
  `mortgageRatePct` and no family size), and has only the apex domain in its
  CORS header (the reconstruction also allows `www`).

---

## homepilot-scenario-share — LIVE CODE (downloaded 2026-09-24)

**Downloaded from Cloudflare on 2026-09-24 with `wrangler init --from-dash`;
this is the live code.** Folder: `workers/homepilot-scenario-share/`
(`src/worker.js`, `wrangler.jsonc`), byte-for-byte as downloaded. Active
version at download: `179ab44b` (2026-07-18, "Added KV namespace binding
SCENARIO_KV"). Uploaded unbundled, so `src/worker.js` is the original source
with its comments (it mentions a `DEPLOY_NOTES.md` that is not in this repo).
The site's Share feature is being removed, but the Worker is still live.

- Endpoints: `POST /save` with `{inc, dn, dbt, fam, wa, wp, rate}` returns
  `{ok:true, id}`; `GET /load?id=` returns the stored JSON as-is. Any other
  path returns a plain 404 `Not found`.
- Validation: `/save` keeps only those seven keys (400 `empty_payload` if none
  are left) but never checks their values, so a 1 MB value is accepted and
  stored. A body of `null` throws (500). `/load` needs an id matching
  `^[A-Za-z0-9]{4,16}$`, otherwise 400 `invalid_id` (also when the id is
  missing); an unknown id returns 404 `{ok:false, error:"not_found"}`.
- IDs: 8 characters from a 57-character alphabet (no 0/O/1/l/I), from
  `crypto.getRandomValues`, rechecked against KV up to 3 times for collisions.
- What it stores, and for how long: income, down payment, debt, family size,
  work arrangement, work postal code and mortgage rate, as JSON in KV
  `SCENARIO_KV` under the ID, with a 180-day TTL (`expirationTtl` 15,552,000
  seconds, now confirmed). No name, email or IP address. Anyone with the link
  can read the entry until it expires. On 2026-09-24 the namespace held 4
  entries, all with an expiry; the last expires 2027-03-20.
- Logs: Workers Logs are on, with invocation logs persisted and
  `redact_query_string: false`, so `/load?id=...` URLs, share IDs included,
  are kept in Cloudflare's logs. The Worker logs nothing itself, so request
  bodies are not in them.
- Origin: only a CORS header (echoes `myhomepilot.ca` or `www.myhomepilot.ca`,
  otherwise `https://myhomepilot.ca`). No server-side origin check. No rate
  limit on either endpoint.
- Bindings/secrets: KV `SCENARIO_KV` (namespace ID
  `61b15a9ce07d4f2c959271361be82669`). No secrets. `workers_dev` on,
  `preview_urls` off, compatibility date 2026-07-18.
- **Differs from the RECONSTRUCTED copy:** same outside contract, but the live
  code returns 404 (not 200) for an unknown scenario, `invalid_id` (not
  `missing_id`) when the id is missing, and a plain 404 (not a 200 JSON help
  message) for other paths. It also checks the id format, retries on
  collision, uses a different ID alphabet and does not catch KV errors.
  `tests/kv_integrity_test.js` also reads only the RECONSTRUCTED copy; against
  this code its "load with no id" check (expects `missing_id`) would fail.

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

### ⚠ ACTION REQUIRED — the live Worker is still unhardened (2026-09-22 audit)

The audit found the live `homepilot-insights` Worker is an **open,
unauthenticated proxy to Anthropic**: it validates only that `body.prompt` is
truthy and forwards it verbatim with the API key. Two consequences:

1. Anyone can use the endpoint as a free Claude API billed to the HomePilot
   Anthropic account. No rate limit, no origin check, no token. CORS does not
   help — it restricts browsers, not `curl`.
2. Every content guardrail (no commute times, no crime claims, no school
   rankings, no price predictions, no demographic framing) lives **client-side
   in `src/ai.js`**, inside a string the caller controls. A caller who does not
   want them simply does not send them.

The reconstruction in this folder has been hardened — server-side guardrails,
origin + prompt-shape checks, and a per-IP rate limit, all covered by
`tests/insights_worker_hardening_test.js`. **That fix is not live.** These
changes only reach production when someone deploys this Worker, and deploying
it means accepting the reconstruction as the source of truth, because the real
source was never recovered.

Two options, in order of preference:

- **Recover the live source first.** `wrangler deployments list` plus the
  Cloudflare dashboard may let you download the deployed bundle. Diff it
  against this file, port the hardening onto the real source, deploy that.
- **Adopt the reconstruction.** Rename the folder and the `wrangler.jsonc`
  `name` back to `homepilot-insights`, set `ANTHROPIC_API_KEY`, deploy, and
  confirm the city-insights panel still works on the live site. The outside
  contract is verified by the client's own tests, so the risk is contained —
  but it is a real cutover, not a no-op.

Until one of those happens, the cheapest interim mitigation is a Cloudflare
Rate Limiting rule on the Worker's route, which needs no deploy at all.

---

## If you're reading this before redeploying any of these Workers

The name changes above make it much harder to accidentally overwrite live
production Workers — but they do NOT fully isolate data (see the KV caveat
under scenario-share). Don't invoke any reconstructed Worker's real
endpoints against production data as a way of "testing" it. If you need to
verify a reconstruction actually works, point its bindings at separate
test resources first.
