# HomePilot

Ontario homebuyer affordability tool built by Sandeep Takhar (RE/MAX Realty Specialists). Buyers enter income, down payment, work location, and family size, and get matched to qualifying Ontario cities, real property types, and honest monthly cost breakdowns. Also functions as a lead-generation engine for Sandeep's real estate business.

Design philosophy: inform the buyer, don't decide for them. Burden thresholds are universal, not income-scaled.

## Live site
myhomepilot.ca (Cloudflare Worker: little-heart-362f)

## Structure (current -- pre-modularization)
- index.html -- the entire app: markup, JS, and city/property data, single file
- tests/regression_suite.js -- automated test suite, run before any deploy
- workers/ -- source for supporting Cloudflare Workers (see below)
- .gitignore -- keeps local secrets (.dev.vars, .env) and local caches (node_modules/, .wrangler/) out of the repo

## Supporting Cloudflare Workers
- homepilot-send-lead -- delivers buyer leads
- homepilot-scenario-share -- stores shared scenarios in KV, returns short link IDs
- homepilot-insights -- generates AI city insights
- homepilot-listings -- Stage 1 connectivity test for the CREA DDF (MLS) feed

Only homepilot-listings has verified real source in this repo (folder: workers/homepilot-listings/). The other three only have Claude-reconstructed backups, kept in folders prefixed RECONSTRUCTED_ (e.g. workers/RECONSTRUCTED_homepilot-send-lead/) with their wrangler.jsonc name fields suffixed -RECONSTRUCTED. This is deliberate: it means an accidental `wrangler deploy` from those folders creates a new, separate Worker instead of silently overwriting the real live one.

Before trusting or redeploying any of these, read workers/WORKER_STATUS.md -- it explains exactly which files are verified vs. reconstructed, how confident each one is, and an important caveat about the scenario-share reconstruction still pointing at the real production KV namespace.

Also in workers/:
- SECRETS.md -- which secrets each Worker needs (names only, never values)
- RECOVERY.md -- what to do if a laptop dies or the project is picked up cold after a long absence

## Branch strategy
- main -- always matches what is actually live in production. Never edit directly.
- dev -- where changes are made and tested before going live.

## Before every deploy
Run: node tests/regression_suite.js index.html
Must show ALL GREEN (245/245 as of the last check) before anything goes to production.

## Rollback
If a deploy breaks something: revert main to the last tagged commit, redeploy that. Fix forward in dev, never patch live.

The tag v1.0.0-baseline marks the known-good starting point -- the tested index.html and regression suite as they stood before any file-splitting work began. If in doubt, that tag is always safe to roll back to.
