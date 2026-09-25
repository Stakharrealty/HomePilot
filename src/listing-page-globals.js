// listing-page-globals.js -- the handful of globals the shared engine files
// (mortgage.js, explainability.js) read, for pages that have no calculator.
//
// In the main app these live in main.js. listings.html and listing.html don't
// load main.js, so they define them here instead, seeded with defaults;
// listing-fit.js sets them from the buyer's saved profile only for the length
// of one computation and then restores them.
//
// NEVER load this on index.html: main.js already declares these names, and a
// second declaration is a hard SyntaxError that would break the whole app.
//
// Requires config.js first (DEFAULT_MORTGAGE_RATE_PCT).
let customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT / 100;
let firstTimeBuyer = false;
let netMonthlyIncome = 0;
// The buyer's monthly debt payments: getFit() counts them in the fit label
// (explainability.js, 2026-09-24, IMPROVEMENT_PLAN.md 2.2b (a)).
let existingDebt = 0;
