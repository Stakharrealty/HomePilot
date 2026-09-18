// homepilot-listings — reporting module
//
// Read-only aggregate queries over the `listings` table, meant to be run
// directly against D1 (via the Cloudflare D1 console/MCP tool, or wrangler
// d1 execute) -- not wired into a public HTTP route, since this is an
// internal diagnostic tool, not buyer-facing.
//
// bySourceBoard / byOriginatingSystem / cityBySourceTemplate were removed
// here (2026-09-18) along with the rest of the DDF pipeline -- they
// grouped by the now-vestigial DDF source-attribution columns
// (member_board_key, originating_system_name; see migrations/
// 0001_source_attribution.sql, which is left in place but unused). byCity
// and byBrokerage below are source-agnostic and still valid once a new
// ingest pipeline is writing rows.

export const REPORTING_QUERIES = {
  byCity: `
    SELECT
      city,
      COUNT(*) AS listing_count
    FROM listings
    GROUP BY city
    ORDER BY listing_count DESC;
  `,

  byBrokerage: `
    SELECT
      COALESCE(brokerage_name, '(unresolved)') AS brokerage,
      COUNT(*) AS listing_count
    FROM listings
    GROUP BY brokerage
    ORDER BY listing_count DESC;
  `,
};
