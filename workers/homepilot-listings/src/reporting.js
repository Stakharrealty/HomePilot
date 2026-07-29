// homepilot-listings — reporting module (added 2026-07-28, DDF
// observability audit).
//
// These are read-only aggregate queries over the `listings` table, meant
// to be run directly against D1 (via the Cloudflare D1 console/MCP tool,
// or wrangler d1 execute) -- not wired into a public HTTP route, since
// this is an internal diagnostic tool, not buyer-facing.
//
// IMPORTANT: originating_system_name/key, source_system_name,
// list_agent_key, and member_board_key (the "source board" / "originating
// system" dimensions) will return only NULL/"(unknown)" until:
//   1. /field-probe (index.js) confirms which candidate field names CREA
//      actually accepts for this account, AND
//   2. the confirmed field(s) are added to SELECT_FIELDS (query.js), AND
//   3. at least one /ingest run has happened since that change.
// Until then, GROUP BY city and GROUP BY brokerage are the only two of
// these four queries that return real, non-null data -- both are included
// below and are runnable today.

export const REPORTING_QUERIES = {
  bySourceBoard: `
    SELECT
      COALESCE(member_board_key, '(unknown)') AS source_board,
      COUNT(*) AS listing_count
    FROM listings
    GROUP BY source_board
    ORDER BY listing_count DESC;
  `,

  byOriginatingSystem: `
    SELECT
      COALESCE(originating_system_name, '(unknown)') AS originating_system,
      COUNT(*) AS listing_count
    FROM listings
    GROUP BY originating_system
    ORDER BY listing_count DESC;
  `,

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

  // Combined view: for a given set of cities, break down by originating
  // system AND source board together -- this is the query that actually
  // answers "Toronto: Source A: X listings, Source B: X listings" once
  // the attribution fields are populated. Cities are parameterized (D1
  // bind params, `?` placeholders) rather than inlined, same convention as
  // getListingsByCity() in db.js.
  cityBySourceTemplate: (cityCount) => `
    SELECT
      city,
      COALESCE(originating_system_name, '(unknown)') AS originating_system,
      COALESCE(member_board_key, '(unknown)') AS source_board,
      COUNT(*) AS listing_count
    FROM listings
    WHERE city IN (${Array(cityCount).fill("?").join(",")})
    GROUP BY city, originating_system, source_board
    ORDER BY city, listing_count DESC;
  `,
};
