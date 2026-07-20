# HomePilot

Ontario homebuyer affordability tool built by Sandeep Takhar (RE/MAX Realty Specialists). Buyers enter income, down payment, work location, and family size, and get matched to qualifying Ontario cities, real property types, and honest monthly cost breakdowns. Also functions as a lead-generation engine for Sandeep's real estate business.

Design philosophy: inform the buyer, don't decide for them. Burden thresholds are universal, not income-scaled.

## Live site
myhomepilot.ca (Cloudflare Worker: little-heart-362f)

## Structure (current -- pre-modularization)
- index.html -- the entire app: markup, JS, and city/property data, single file
- tests/regression_suite.js -- automated test suite, run before any deploy
- workers/ -- source for supporting Cloudflare Workers (see below)

## Supporting Cloudflare Workers
- homepilot-send-lead -- delivers buyer leads
- homepilot-scenario-share -- stores shared scenarios in KV, returns short link IDs
- homepilot-insights -- generates AI city insights
- homepilot-listings -- Stage 1 connectivity test for the CREA DDF (MLS) feed

Before trusting or redeploying any of these, read workers/WORKER_STATUS.md -- some of these files are verified original source, others are reconstructions Claude rebuilt after the originals were lost. The status file explains exactly which is which and how confident each one is.

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
