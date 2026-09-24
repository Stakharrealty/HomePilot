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
// hint, the rate line under the top section, the disclaimer page, DATA_FRESHNESS entry)
// reads from this constant. Update ONLY here when refreshing the rate.
// 4.39% since 2026-09-24 (IMPROVEMENT_PLAN.md 3.5a): the cheapest advertised
// insured 5-year fixed that day. A weekly automatic update (3.5) waits until
// after beta.
const DEFAULT_MORTGAGE_RATE_PCT = 4.39;

// ── DATA FRESHNESS TRACKER — updated whenever a hardcoded estimate is re-verified ──
// Purpose: every number in this file that isn't live-computed is a snapshot in time.
// This object is the single place to check "how stale is this?" before trusting an
// estimate for a real buyer conversation. Shown in Dev Mode (Shift+D) only — never
// buyer-facing. To refresh an item: verify against the source listed, update value +
// lastUpdated, and update this comment's date if you touch multiple items at once.
const DATA_FRESHNESS = {
  mortgageRate: {
    value: DEFAULT_MORTGAGE_RATE_PCT + "%", lastUpdated: "2026-09-24",
    source: "Cheapest advertised insured 5-year fixed on Sept 24, 2026: nesto 4.39%, Ratehub 4.34%. " +
            "Fixed rates rose with the 5-year Government of Canada bond yield (3.18% to 3.54%) since " +
            "the last update (4.19% on July 9, 2026, against 3.94%–4.09%). Fixed, not variable: " +
            "conservative, and the payment is locked for the term (IMPROVEMENT_PLAN.md 3.5a).",
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
  incomeTaxModel: {
    value: "2024 federal + Ontario brackets, BPA credits, surtax, health premium, CPP/CPP2/EI",
    lastUpdated: "2026-09-22",
    source: "estimateOntarioNetAnnual() in utils.js. Added to this tracker during the 2026-09-22 " +
            "audit, which found the model silently omitting the Ontario surtax, the Ontario Health " +
            "Premium and CPP2 — overstating net income by $450/yr at $40K and $21,974/yr at $400K. " +
            "Because net income is the denominator of getFit(), every affordability label was " +
            "optimistic by 1–2 percentage points. It was never in this tracker before, which is " +
            "why nothing ever prompted a re-check.",
    refreshCadence: "Annually — brackets, BPA, CPP/EI maximums and the surtax thresholds are indexed each January."
  },
  condoFees: {
    value: "Median real monthly fee of each place's condo listings where 10+ have one (47 places), " +
           "else the typed estimate; scaled 0.5× around the place's typical condo price (see CONDO_FEES + calcCosts)",
    lastUpdated: "2026-09-24",
    source: "tools/city-prices.mjs over the homepilot-listings D1 database (PropTx IDX, read-only), " +
            "with the listing pages' own fee rules (IMPROVEMENT_PLAN.md 3.2). CONDO_FEES_SOURCE in cities.js " +
            "says which places use listings.",
    refreshCadence: "Weekly (plan 3.1a) — run `node tools/city-prices.mjs`; a failed run keeps the last good table."
  },
  cityPrices: {
    value: "Median asking price of each place's current listings × 0.97 where it has 10+ of that type " +
           "(188 of 220), else the typed 2025 table (PT_TYPED); PT_SOURCE in cities.js says which",
    lastUpdated: "2026-09-24",
    source: "tools/city-prices.mjs over the homepilot-listings D1 database (PropTx IDX, read-only), with the " +
            "listings page's own place and home-type rules (IMPROVEMENT_PLAN.md 3.1a). Before/after for every " +
            "place and type, against TRREB sold figures: _private/phase3/city-prices-before-after.md.",
    refreshCadence: "Weekly (plan 3.1a) — run `node tools/city-prices.mjs`; a failed run keeps the last good table."
  }
};
function daysSince(dateStr){ return Math.floor((Date.now()-new Date(dateStr).getTime())/86400000); }
