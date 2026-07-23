// Phase 4 (DDF) — stale listing removal test for homepilot-listings.
//
// Why this exists: the scheduled refresh job (added 2026-07-21) needs to
// remove listings CREA no longer returns (sold, delisted, no longer
// matching the filter) -- otherwise the `listings` table can only grow,
// and buyers could eventually be shown sold houses as if they were active.
// The mechanism is "mark and sweep": every row upsertListing() touches this
// run gets last_seen_at stamped with the run's start time; anything with an
// older (or null) last_seen_at gets deleted by deleteStaleListings().
//
// This test exercises the REAL upsertListing() and deleteStaleListings()
// functions from db.js, against an in-memory fake D1 -- never touches the
// real production database. Confirms:
//   1. A listing touched by the current run survives
//   2. A listing NOT touched by the current run gets deleted
//   3. The safety guard in ingest.js (never sweep if 0 rows were written)
//      is present in source, since a CREA outage returning 0 results
//      should never be allowed to wipe the whole table
//
// Run: node tests/listings_stale_removal_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

// Minimal in-memory fake of D1's prepare().bind().run() interface, just
// enough to exercise the real INSERT...ON CONFLICT and DELETE statements
// db.js actually issues. Not a full SQL engine -- parses just enough to
// route to the right in-memory operation.
function makeFakeD1() {
  const rows = new Map(); // listing_key -> row object

  return {
    _rows: rows,
    prepare(sql) {
      const isInsert = /^INSERT INTO listings/.test(sql);
      const isDelete = /^DELETE FROM listings/.test(sql);
      return {
        bind(...args) {
          return {
            async run() {
              if (isInsert) {
                const [
                  listing_key, list_price, city, postal_code, latitude, longitude,
                  property_subtype, structure_type, bedrooms, bathrooms, parking_total,
                  listing_url, brokerage_name, listing_status, last_updated, last_seen_at,
                ] = args;
                rows.set(listing_key, {
                  listing_key, list_price, city, last_seen_at,
                });
                return { meta: { changes: 1 } };
              }
              if (isDelete) {
                // args = [cutoff, ...citiesToSweep] -- must match the real
                // db.js query shape (bug fix 2026-07-23: DELETE is now
                // scoped by `city IN (...)`, not global).
                const [cutoff, ...cities] = args;
                const citySet = new Set(cities);
                let changes = 0;
                for (const [key, row] of rows.entries()) {
                  if (!citySet.has(row.city)) continue; // not swept this run
                  if (row.last_seen_at === null || row.last_seen_at === undefined || row.last_seen_at < cutoff) {
                    rows.delete(key);
                    changes++;
                  }
                }
                return { meta: { changes } };
              }
              throw new Error(`Fake D1: unrecognized SQL: ${sql.slice(0, 50)}`);
            },
          };
        },
      };
    },
  };
}

async function main() {
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);

  const fakeDb = makeFakeD1();

  // --- Simulate run #1: two listings come in ---
  const run1Time = "2026-07-21T08:00:00.000Z";
  await db.upsertListing(fakeDb, { ListingKey: "AAA111", ListPrice: 500000, City: "Guelph" }, run1Time);
  await db.upsertListing(fakeDb, { ListingKey: "BBB222", ListPrice: 600000, City: "Barrie" }, run1Time);

  check("after run #1, both listings present", fakeDb._rows.size === 2, `size=${fakeDb._rows.size}`);

  // --- Simulate run #2, a day later: AAA111 sold (CREA stops returning it),
  //     BBB222 still active, CCC333 is a brand new listing ---
  const run2Time = "2026-07-22T08:00:00.000Z";
  await db.upsertListing(fakeDb, { ListingKey: "BBB222", ListPrice: 595000, City: "Barrie" }, run2Time);
  await db.upsertListing(fakeDb, { ListingKey: "CCC333", ListPrice: 700000, City: "Orangeville" }, run2Time);

  // Guelph was successfully re-queried this run (just returned nothing --
  // AAA111 is genuinely gone), so it belongs in the sweep scope along with
  // the cities that produced rows.
  const citiesSucceededRun2 = ["Guelph", "Barrie", "Orangeville"];
  const deletedCount = await db.deleteStaleListings(fakeDb, run2Time, citiesSucceededRun2);

  check("deleteStaleListings removed exactly 1 row (the sold listing)", deletedCount === 1, `deleted=${deletedCount}`);
  check("sold listing (AAA111) is actually gone", !fakeDb._rows.has("AAA111"));
  check("still-active listing (BBB222) survived and was updated", fakeDb._rows.has("BBB222") && fakeDb._rows.get("BBB222").list_price === 595000);
  check("new listing (CCC333) is present", fakeDb._rows.has("CCC333"));
  check("final table size is 2 (BBB222 + CCC333), not 3", fakeDb._rows.size === 2, `size=${fakeDb._rows.size}`);

  // --- Bug fix 2026-07-23: a city whose fetch FAILED this run must not
  //     have its existing listings swept just because they weren't
  //     re-confirmed. Simulates exactly the reported scenario: cities
  //     31-49 fail mid-run (rate limit), earlier cities succeed. ---
  const run3Time = "2026-07-23T08:00:00.000Z";
  await db.upsertListing(fakeDb, { ListingKey: "DDD444", ListPrice: 550000, City: "Kingston" }, run1Time); // seeded from an earlier run, never touched since
  fakeDb._rows.get("DDD444").last_seen_at = run1Time; // predates run3 -- would look "stale" globally

  // Run 3: Barrie + Orangeville succeed and get re-confirmed; Kingston's
  // fetch fails (simulated CREA rate limit) so it's NOT in this run's
  // success list.
  await db.upsertListing(fakeDb, { ListingKey: "BBB222", ListPrice: 595000, City: "Barrie" }, run3Time);
  await db.upsertListing(fakeDb, { ListingKey: "CCC333", ListPrice: 700000, City: "Orangeville" }, run3Time);
  const citiesSucceededRun3 = ["Barrie", "Orangeville"]; // Kingston deliberately excluded -- its fetch failed

  const deletedCountRun3 = await db.deleteStaleListings(fakeDb, run3Time, citiesSucceededRun3);

  check(
    "run with a failed city deletes 0 rows from that city (Kingston listing survives despite stale last_seen_at)",
    fakeDb._rows.has("DDD444"),
    "DDD444 (Kingston) should NOT have been deleted -- its city fetch failed, so it was never re-confirmed, not proven gone"
  );
  check(
    "successfully-swept cities are unaffected by the fix (still confirmed/updated normally)",
    fakeDb._rows.has("BBB222") && fakeDb._rows.has("CCC333")
  );
  check(
    "deleteStaleListings with an empty citiesToSweep list is a safe no-op",
    (await db.deleteStaleListings(fakeDb, run3Time, [])) === 0
  );
  check(
    "deleteStaleListings with a missing/undefined citiesToSweep is a safe no-op, not a global sweep",
    (await db.deleteStaleListings(fakeDb, run3Time, undefined)) === 0
  );
  check("run 3 deleted 0 rows (nothing genuinely gone from the swept cities)", deletedCountRun3 === 0, `deleted=${deletedCountRun3}`);

  // --- Safety guard check: ingest.js must never sweep on a 0-write run ---
  const ingestSrc = fs.readFileSync(path.join(SRC_DIR, "ingest.js"), "utf8");
  const hasGuard = /if\s*\(\s*totalWritten\s*>\s*0\s*\)/.test(ingestSrc);
  check(
    "ingest.js has a guard against sweeping on a 0-listing run (CREA outage safety)",
    hasGuard,
    "without this, an auth failure or CREA outage returning 0 results could wipe the entire table"
  );

  // --- ingest.js must actually scope the sweep to succeeded cities, not
  //     call deleteStaleListings with the whole table implicitly ---
  const scopesSweepToSucceededCities = /deleteStaleListings\(\s*env\.DB\s*,\s*runStartedAt\s*,\s*citiesSucceeded\s*\)/.test(ingestSrc);
  check(
    "ingest.js calls deleteStaleListings() with a citiesSucceeded argument (not table-wide)",
    scopesSweepToSucceededCities,
    "without this, a partial CREA failure mid-run could wrongly delete active listings from the cities that failed"
  );
  const excludesFailedCities = /citiesSucceeded\s*=\s*cityResults\.filter\(\s*\(?r\)?\s*=>\s*!r\.failed\s*\)/.test(ingestSrc);
  check(
    "ingest.js derives citiesSucceeded by excluding failed cities from cityResults",
    excludesFailedCities
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
