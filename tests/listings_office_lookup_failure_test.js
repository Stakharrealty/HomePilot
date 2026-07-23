// Phase 7 (DDF) — office-lookup failure visibility test for
// homepilot-listings. Bug fix, 2026-07-23.
//
// Why this exists: fetchOfficeNames() in ingest.js used to do
// `if (!resp.ok) continue` with zero logging on a failed batch -- a
// brokerage name lookup could fail silently and there was no way to tell
// a genuinely-missing OfficeName apart from a failed lookup. This was very
// likely the real root cause of the 28% brokerage-name resolution rate
// observed all last session and never diagnosed.
//
// This test exercises the REAL runIngest() end-to-end (mocked global
// fetch, in-memory fake D1 -- never touches CREA or production D1) and
// confirms:
//   1. A failed Office batch is actually logged via console.error with
//      real, useful context (not a bare silent `continue`)
//   2. The failure is surfaced as real numbers on the ingest result
//      (officeLookupFailedBatches, officeLookupFailedKeyCount), not hidden
//   3. A failed office lookup still doesn't crash ingest -- the listing is
//      written with brokerageName: null, same as before the fix
//
// Run: node tests/listings_office_lookup_failure_test.js

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

// Minimal in-memory fake D1 -- only what runIngest() actually calls
// (INSERT via upsertListing, DELETE via deleteStaleListings).
function makeFakeD1() {
  const rows = new Map();
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
                // Positions match db.js's real bind() order exactly:
                // 0 listing_key, 2 city, 12 brokerage_name, 15 last_seen_at
                const [listing_key, , city, , , , , , , , , , brokerage_name, , , last_seen_at] = args;
                rows.set(listing_key, { listing_key, city, brokerage_name, last_seen_at });
                return { meta: { changes: 1 } };
              }
              if (isDelete) {
                const [cutoff, ...citiesToSweep] = args;
                const citySet = new Set(citiesToSweep);
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
  const cities = await import(pathToFileURL(path.join(SRC_DIR, "cities.js")).href);
  const TEST_CITY = cities.HOMEPILOT_CITIES[0];

  // --- Mock global fetch: token endpoint OK, one city returns a listing
  //     with a ListOfficeKey, every other city returns empty, and the
  //     Office lookup batch FAILS (simulating a CREA hiccup) ---
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const consoleErrorCalls = [];
  console.error = (...args) => { consoleErrorCalls.push(args.join(" ")); };

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("identity.crea.ca")) {
      return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    }
    if (u.includes("/Office")) {
      // Simulate the exact failure mode this bug fix targets.
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (u.includes("/Property")) {
      if (u.includes(encodeURIComponent(TEST_CITY))) {
        return {
          ok: true,
          json: async () => ({
            value: [
              { ListingKey: "OFF1", ListPrice: 600000, City: TEST_CITY, ListOfficeKey: "OFFICEKEY-X" },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ value: [] }) };
    }
    throw new Error(`Unexpected fetch in test: ${u}`);
  };

  try {
    const ingest = await import(pathToFileURL(path.join(SRC_DIR, "ingest.js")).href);
    const fakeDb = makeFakeD1();
    const result = await ingest.runIngest({ DB: fakeDb, DDF_CLIENT_ID: "x", DDF_CLIENT_SECRET: "y" });

    // --- 1. Failure is actually logged, with real context ---
    const loggedFailure = consoleErrorCalls.some(
      (line) => line.includes("Office lookup batch failed") && line.includes("503")
    );
    check(
      "a failed Office batch is logged via console.error with the real status code",
      loggedFailure,
      `console.error calls: ${JSON.stringify(consoleErrorCalls)}`
    );

    // --- 2. Failure is surfaced as real stats on the result, not hidden ---
    check(
      "runIngest() result includes officeLookupFailedBatches >= 1",
      typeof result.officeLookupFailedBatches === "number" && result.officeLookupFailedBatches >= 1,
      `officeLookupFailedBatches=${result.officeLookupFailedBatches}`
    );
    check(
      "runIngest() result includes officeLookupFailedKeyCount matching the failed batch",
      result.officeLookupFailedKeyCount === 1,
      `officeLookupFailedKeyCount=${result.officeLookupFailedKeyCount}`
    );

    // --- 3. Still doesn't crash -- listing written with brokerageName null ---
    const row = fakeDb._rows.get("OFF1");
    check(
      "listing with a failed office lookup still gets written (not dropped/crashed)",
      !!row
    );
    check(
      "brokerage_name falls back to null on a failed lookup, same as before the fix",
      !!row && row.brokerage_name === null
    );

  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
