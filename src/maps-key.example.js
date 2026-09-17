// maps-key.example.js — template only. Contains no real key.
//
// The real file is src/maps-key.js, which is git-ignored and never committed.
// In production it is generated at deploy time from the GOOGLE_MAPS_API_KEY
// GitHub secret (see .github/workflows/deploy.yml, "Build deploy folder").
//
// For local development: copy this file to src/maps-key.js and paste in a
// browser key restricted to localhost. If src/maps-key.js is absent, the map
// block simply hides itself and nothing else on the page changes.

window.HOMEPILOT_MAPS_KEY = '';
