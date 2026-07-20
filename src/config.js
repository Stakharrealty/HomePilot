// config.js — HomePilot shared constants
//
// Extracted from index.html on July 20, 2026 as the first step of Phase 2
// (splitting the single-file app into modules). Pure relocation — no logic
// changed, no values changed. Loaded via <script src="src/config.js"></script>
// before the main inline script, so these remain plain global consts/functions
// in the same shared scope the app has always used (no ES module system
// introduced — keeps this a low-risk, behavior-identical move).

// Single source of truth for the default/market mortgage rate — every other
// reference in the app (slider default, reset behavior, "current market rate"
// hint, share/scenario comparisons, footer disclaimer, DATA_FRESHNESS entry)
// reads from this constant. Update ONLY here when refreshing the rate.
const DEFAULT_MORTGAGE_RATE_PCT = 4.19;

// ── DATA FRESHNESS TRACKER — updated whenever a hardcoded estimate is re-verified ──
// Purpose: every number in this file that isn't live-computed is a snapshot in time.
// This object is the single place to check "how stale is this?" before trusting an
// estimate for a real buyer conversation. Shown in Dev Mode (Shift+D) only — never
// buyer-facing. To refresh an item: verify against the source listed, update value +
// lastUpdated, and update this comment's date if you touch multiple items at once.
const DATA_FRESHNESS = {
  mortgageRate: {
    value: DEFAULT_MORTGAGE_RATE_PCT + "%", lastUpdated: "2026-07-09",
    source: "Ratehub.ca + nesto.ca best insured 5yr fixed rates (3.94%–4.09% range July 8, 2026); " +
            "set slightly above the rock-bottom broker teaser to reflect a realistically achievable rate.",
    refreshCadence: "Monthly — fixed rates move with bond yields, can shift meaningfully in weeks."
  },
  propertyTaxRates: {
    value: "51 of 55 cities directly sourced, 4 via documented proxy (Shelburne, Grand Valley, Mono, Erin)",
    lastUpdated: "2026-07-06",
    source: "Official municipal by-laws (Fort Erie, Midland, Cobourg, Wasaga Beach, Orangeville) and " +
            "WOWA.ca published final residential rates for the rest. See tx: comment block above const M.",
    refreshCadence: "Annually — municipalities finalize tax rates each spring."
  },
  homeInsurance: {
    value: "City base × 1.28 uplift, 0.5× price-scaling, condo factor 0.40×", lastUpdated: "2026-07-06",
    source: "Rates.ca Home Insuramap 2026 report (ON avg $2,235/yr detached, Toronto ~$1,617/yr).",
    refreshCadence: "Annually — insurance benchmarks are typically republished yearly."
  },
  condoFees: {
    value: "City base fee scaled 0.5× around each city's typical condo price (see CONDO_FEES + calcCosts)",
    lastUpdated: "2026-07-06",
    source: "Structural fix only (no new market data) — base $/mo figures are still estimates, not sourced " +
            "from real condo corporation budgets. Upgrade path: read actual fees from IDX listings once live.",
    refreshCadence: "No live source yet — revisit once DDF/IDX lands."
  }
};
function daysSince(dateStr){ return Math.floor((Date.now()-new Date(dateStr).getTime())/86400000); }
