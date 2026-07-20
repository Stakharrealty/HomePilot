# Disaster Recovery Reference

Read this if: your laptop dies, you haven't touched this project in months,
or someone else needs to pick up HomePilot from zero. Everything below was
verified directly against GitHub and Cloudflare on July 20, 2026.

---

## The 30-second version

1. Live site: **myhomepilot.ca** — if this loads, the core app is fine.
2. All code lives at: **github.com/Stakharrealty/HomePilot**
3. If something's broken, the safe rollback point is git tag **`v1.0.0-baseline`**.
4. Real infrastructure = **Cloudflare** (not Netlify — that was disconnected
   and deleted in July 2026 after being found still auto-building on every
   GitHub push, wasting credits).

---

## Where everything actually lives

### GitHub
- Repo: `github.com/Stakharrealty/HomePilot`
- `main` branch = always mirrors what's live in production. Never edit directly.
- `dev` branch = where changes get made and tested before going live.
- Tag `v1.0.0-baseline` = known-good rollback point (tested `index.html`
  at 245/245 regression tests, taken before any file-splitting work began).

### Cloudflare account
- Account: `Stakharrealty@gmail.com's Account`
- Account ID: `17962d34dfe3fc795e7a45850c7ecf45`
- Workers subdomain: `stakharrealty.workers.dev`

### Live Workers (confirmed directly in the Cloudflare dashboard, July 20, 2026)
| Worker name | Route | Purpose |
|---|---|---|
| `little-heart-362f` | `myhomepilot.ca` (+1 other route) | **Main site** — serves the actual HomePilot app |
| `homepilot-send-lead` | `homepilot-send-lead.stakharrealty.workers.dev` | Emails Sandeep when a buyer submits the lead form |
| `homepilot-scenario-share` | `homepilot-scenario-share.stakharrealty.workers.dev` | Stores shared scenarios in KV, returns short link IDs |
| `homepilot-insights` | `homepilot-insights.stakharrealty.workers.dev` | Generates AI city insights via Anthropic's API |
| `homepilot-listings` | `homepilot-listings.stakharrealty.workers.dev` | Stage 1 test connection to the CREA DDF (MLS) feed |

### Storage
- KV namespace: `SCENARIO_KV`, ID `61b15a9ce07d4f2c959271361be82669`
  (used by `homepilot-scenario-share`)

### Domain
- `myhomepilot.ca` — registered and owned by Sandeep directly (not through
  Cloudflare registrar transfer at last check — verify current registrar if
  renewing)

---

## Source code status (see `workers/WORKER_STATUS.md` for full detail)

| Location | Status |
|---|---|
| `index.html` | Verified — matches what's live, regression-tested |
| `workers/homepilot-listings/` | Verified original source |
| `workers/homepilot-scenario-share/` | Reconstructed (high confidence — behavior tested live) |
| `workers/homepilot-send-lead/` | Reconstructed (medium confidence) |
| `workers/homepilot-insights/` | Reconstructed (medium confidence) |
| `little-heart-362f` (main site Worker) | **Not yet backed up anywhere in this repo — see gap below** |

---

## Known gap: the main site Worker itself isn't backed up

`little-heart-362f` is the Worker that actually serves `myhomepilot.ca` —
and as of this writing, its exact deployed source isn't separately confirmed
to match `index.html` in this repo. In practice `index.html` IS the app, so
this is likely low-risk, but if `little-heart-362f` has any wrapper code
around serving that file, it hasn't been independently verified here.

---

## Recovery checklist

If starting completely from scratch (new computer, long absence, etc.):

- [ ] Confirm `myhomepilot.ca` still resolves and the site loads
- [ ] Log into Cloudflare (`Stakharrealty@gmail.com`) and confirm all 5
      Workers listed above are still present and active
- [ ] Log into GitHub (`Stakharrealty` account) and confirm the repo,
      `main`/`dev` branches, and `v1.0.0-baseline` tag are all intact
- [ ] Pull the repo locally: `git clone https://github.com/Stakharrealty/HomePilot`
- [ ] Run the regression suite before touching anything:
      `node tests/regression_suite.js index.html` — should show `ALL GREEN`
- [ ] If something is broken and you need to roll back:
      `git checkout v1.0.0-baseline -- index.html`, verify it passes the
      regression suite, then redeploy that version
- [ ] Re-check `workers/SECRETS.md` for which secrets each Worker needs,
      and re-set them via `wrangler secret put` if redeploying any Worker
      from scratch

---

## What to do if you genuinely can't recover something

If a Worker's real source is ever lost the way the original three were:
this repo's `workers/WORKER_STATUS.md` reconstructions are a reasonable
starting point for rebuilding behavior, but should be tested against real
traffic patterns before being trusted as a full replacement.
