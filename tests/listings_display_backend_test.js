// Phase 6 (DDF) — listing display backend test for homepilot-listings.
//
// Covers three pieces added 2026-07-22 for the listing display UI:
//   1. buildOfficeQuery() — the second query needed to look up brokerage
//      names, since Office is a separate DDF entity from Property (no
//      $expand shortcut exists, confirmed via live /metadata check)
//   2. buildViewEventUrl() — CREA Analytics Web Service URL construction,
//      using the real DestinationID (66674) issued by CREA for
//      myhomepilot.ca on 2026-07-22 (case #00258976)
//   3. Photos + brokerage name actually round-tripping correctly through
//      upsertListing() -> getListingsByCity(), using the same in-memory
//      fake D1 pattern as listings_stale_removal_test.js
//
// This test does NOT call CREA or the real analytics endpoint -- URL
// building and DB round-tripping are pure logic, testable without network.

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

// Same fake D1 pattern as listings_stale_removal_test.js, extended to
// support SELECT (needed for getListingsByCity).
function makeFakeD1() {
  const rows = new Map();

  return {
    _rows: rows,
    prepare(sql) {
      const isInsert = /^INSERT INTO listings/.test(sql);
      const isSelect = /^SELECT/.test(sql);
      return {
        bind(...args) {
          return {
            async run() {
              if (isInsert) {
                const [
                  listing_key, list_price, city, postal_code, latitude, longitude,
                  property_subtype, structure_type, bedrooms, bathrooms, parking_total,
                  listing_url, brokerage_name, listing_status, last_updated, last_seen_at,
                  photos,
                ] = args;
                rows.set(listing_key, {
                  listing_key, list_price, city, postal_code, bedrooms, bathrooms,
                  parking_total, listing_url, brokerage_name, photos, last_updated: last_updated,
                });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Fake D1 (run): unrecognized SQL: ${sql.slice(0, 50)}`);
            },
            async all() {
              if (isSelect) {
                const [city, limit] = args;
                const matches = [...rows.values()]
                  .filter((r) => r.city === city)
                  .slice(0, limit);
                return { results: matches };
              }
              throw new Error(`Fake D1 (all): unrecognized SQL: ${sql.slice(0, 50)}`);
            },
          };
        },
      };
    },
  };
}

async function main() {
  // --- 1. buildOfficeQuery ---
  const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);
  check("query.js exports buildOfficeQuery (function)", typeof query.buildOfficeQuery === "function");

  const officeParams = query.buildOfficeQuery(["OFFICE1", "OFFICE2"]);
  check(
    "buildOfficeQuery() produces a filter with 'in' on OfficeKey",
    officeParams.get("$filter")?.includes("OfficeKey in (") ?? false
  );
  check(
    "buildOfficeQuery() selects OfficeName",
    officeParams.get("$select")?.includes("OfficeName") ?? false
  );

  // --- 2. analytics.js ---
  const analytics = await import(pathToFileURL(path.join(SRC_DIR, "analytics.js")).href);
  check("analytics.js exports DESTINATION_ID", typeof analytics.DESTINATION_ID === "number");
  check(
    "DESTINATION_ID is the real CREA-issued value (66674), not a placeholder",
    analytics.DESTINATION_ID === 66674
  );
  check("analytics.js exports buildViewEventUrl (function)", typeof analytics.buildViewEventUrl === "function");

  const eventUrl = analytics.buildViewEventUrl({ listingId: "12345", uuid: "test-uuid-abc" });
  check("view event URL points at the real CREA analytics endpoint", eventUrl.startsWith("https://analytics.crea.ca/LogEvents.svc/LogEvents"));
  check("view event URL includes ListingID", eventUrl.includes("ListingID=12345"));
  check("view event URL includes the real DestinationID (66674)", eventUrl.includes("DestinationID=66674"));
  check("view event URL includes EventType=view", eventUrl.includes("EventType=view"));
  check("view event URL includes the UUID", eventUrl.includes("UUID=test-uuid-abc"));

  let threwOnMissingListingId = false;
  try {
    analytics.buildViewEventUrl({ uuid: "x" });
  } catch {
    threwOnMissingListingId = true;
  }
  check("buildViewEventUrl throws if listingId is missing (fails loud, not silent)", threwOnMissingListingId);

  // --- 3. photos + brokerage round-trip through D1 ---
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  check("db.js exports getListingsByCity (function)", typeof db.getListingsByCity === "function");

  const fakeDb = makeFakeD1();
  const runTime = "2026-07-22T08:00:00.000Z";

  await db.upsertListing(
    fakeDb,
    {
      ListingKey: "PHOTO1",
      ListPrice: 650000,
      City: "Guelph",
      Media: [
        { MediaURL: "https://cdn.example.com/photo1.jpg" },
        { MediaURL: "https://cdn.example.com/photo2.jpg" },
      ],
    },
    runTime,
    "Century 21 Test Realty"
  );

  const results = await db.getListingsByCity(fakeDb, "Guelph", 20);
  check("getListingsByCity returns the inserted listing", results.length === 1);

  if (results.length === 1) {
    const listing = results[0];
    check("brokerage name round-tripped correctly", listing.brokerageName === "Century 21 Test Realty");
    check(
      "photos round-tripped as a real array with both URLs, not a raw JSON string",
      Array.isArray(listing.photos) &&
        listing.photos.length === 2 &&
        listing.photos[0] === "https://cdn.example.com/photo1.jpg"
    );
  }

  // Listing with no Media field at all should not crash, just get an empty
  // photos array -- real DDF listings sometimes have no photos yet.
  await db.upsertListing(fakeDb, { ListingKey: "NOPHOTO1", ListPrice: 500000, City: "Guelph" }, runTime, null);
  const results2 = await db.getListingsByCity(fakeDb, "Guelph", 20);
  const noPhotoListing = results2.find((l) => l.listingKey === "NOPHOTO1");
  check(
    "listing with no Media field gets an empty photos array, not a crash",
    !!noPhotoListing && Array.isArray(noPhotoListing.photos) && noPhotoListing.photos.length === 0
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
