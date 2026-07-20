# Secrets Inventory

This file lists WHICH secrets each part of HomePilot needs, by name only.
**It never contains actual secret values.** Real secret values live only in
Cloudflare (via `wrangler secret put` or the dashboard's Settings → Variables
page for each Worker) — never in this repo, never in plain text anywhere.

If you need to redeploy a Worker from scratch, this tells you what secrets
it expects so you know what to set before it will work correctly.

---

## Cloudflare Worker secrets

### homepilot-insights
| Secret name | Purpose | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | Calls Anthropic's API to generate AI city insights | Confirmed needed (referenced in the reconstructed `index.js` and the pre-migration Netlify function it replaced) |

### homepilot-listings
| Secret name | Purpose | Status |
|---|---|---|
| `DDF_CLIENT_ID` | CREA DDF feed username-equivalent | Confirmed needed (referenced directly in `workers/homepilot-listings/index.js`) |
| `DDF_CLIENT_SECRET` | CREA DDF feed password-equivalent | Confirmed needed (same as above) |

### homepilot-send-lead
| Secret name | Purpose | Status |
|---|---|---|
| *(none — uses a binding, not a secret)* | Sends email via Cloudflare's Email Sending binding (`SEND_EMAIL`), not an API key | The binding itself is configured in `wrangler.jsonc`, not via `wrangler secret put` |

### homepilot-scenario-share
| Secret name | Purpose | Status |
|---|---|---|
| *(none — uses a binding, not a secret)* | Reads/writes the `SCENARIO_KV` KV namespace, not an API key | The binding is configured in `wrangler.jsonc` (namespace ID `61b15a9ce07d4f2c959271361be82669`) |

### little-heart-362f (main site Worker)
| Secret name | Purpose | Status |
|---|---|---|
| — | — | **TODO — not yet audited.** This is the main production Worker serving `myhomepilot.ca`. Its secrets (if any) have not been checked as part of this pass. If it calls any of the other Workers or external services directly, list what it needs here. |

---

## Where secrets actually live

All real secret values are set directly in Cloudflare, two ways:
1. **CLI:** `npx wrangler secret put SECRET_NAME` (prompts for the value,
   never written to a file)
2. **Dashboard:** each Worker's page → Settings → Variables and Secrets

**Never** put a real secret value in:
- This repo, any branch
- `wrangler.jsonc` / `wrangler.toml` (these are config, and they're
  committed to GitHub — anything in them is effectively public)
- Chat with Claude, since conversations may be logged

## TODO for Sandeep

- [ ] Confirm whether `little-heart-362f` (the main site) needs any secrets
      of its own, and add them to the table above
- [ ] Confirm the `homepilot-send-lead` Worker's email binding still doesn't
      use a `destination_address` restriction (removed at some point after
      it caused delivery errors, per project notes — worth a quick check in
      the dashboard to be sure nothing reverted)
