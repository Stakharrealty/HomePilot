// Phase 8 (DDF) — real listing detail test for homepilot-listings.
//
// Why this exists: the listing card was redirecting to a GUESSED URL
// (realtor.ca/real-estate/${ListingKey}) that 404'd in production, and
// showed no description/address/year-built/lot-size at all -- forcing a
// click-through to see anything, which also 404'd. Fixed by:
//   1. Using CREA's real ListingURL field instead of guessing a pattern
//   2. Storing and displaying PublicRemarks (description), YearBuilt,
//      LotSizeArea/Units directly in-app
//   3. Storing UnparsedAddress ONLY when InternetAddressDisplayYN is
//      explicitly true -- a real seller-consent flag, not a data-quality
//      field. This is the highest-stakes check in this file: showing an
//      address the seller did not consent to display is a genuine
//      privacy/compliance problem, not a cosmetic bug.
//
// This test does NOT call CREA. It statically checks query.js's field
// list and functionally checks db.js's write-path consent gating using a
// fake D1 that captures bound values instead of running real SQL.
//
// Run: node tests/listings_detail_fields_test.js

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

function makeFakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const record = { sql, params: null };
      calls.push(record);
      return {
        bind(...params) {
          record.params = params;
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      };
    },
  };
}

async function main() {
  const querySrc = fs.readFileSync(path.join(SRC_DIR, "query.js"), "utf8");
  const dbModule = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);

  // --- 1. query.js requests the real fields ---
  for (const field of ["ListingURL", "PublicRemarks", "UnparsedAddress", "InternetAddressDisplayYN", "YearBuilt", "LotSizeArea", "LotSizeUnits"]) {
    check(`query.js SELECT_FIELDS includes ${field}`, new RegExp(`["']${field}["']`).test(querySrc));
  }

  // --- 2. db.js no longer guesses the listing URL ---
  const dbSrc = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
  check(
    "db.js's actual .bind() call does NOT construct a guessed realtor.ca URL pattern (was 404ing in production) -- checked against code only, not comments",
    (() => {
      const bindLines = dbSrc.split("\n").filter((l) => !l.trim().startsWith("//"));
      return !bindLines.some((l) => /realtor\.ca\/real-estate\/\$\{/.test(l));
    })()
  );
  check(
    "db.js uses r.ListingURL directly as the stored listing_url",
    /r\.ListingURL/.test(dbSrc)
  );

  // --- 3. Consent gating: the actual highest-stakes check in this file ---
  const baseListing = {
    ListingKey: "TEST1", ListPrice: 500000, City: "Brampton",
    UnparsedAddress: "123 Main St, Brampton, ON L6Y 0A1",
  };

  {
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing, InternetAddressDisplayYN: true }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    check(
      "InternetAddressDisplayYN=true -> the real address IS stored",
      params.includes("123 Main St, Brampton, ON L6Y 0A1")
    );
  }
  {
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing, InternetAddressDisplayYN: false }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    check(
      "InternetAddressDisplayYN=false -> the address is NEVER stored, even though CREA sent it",
      !params.includes("123 Main St, Brampton, ON L6Y 0A1")
    );
  }
  {
    // Missing/undefined consent flag -- must default to NOT showing the
    // address. "We don't know if they consented" must never be treated as
    // "assume yes".
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    check(
      "InternetAddressDisplayYN missing/undefined -> address defaults to NOT stored (no assume-consent)",
      !params.includes("123 Main St, Brampton, ON L6Y 0A1")
    );
  }
  {
    // A string "true" (not boolean true) must not be treated as consent --
    // guards against a subtle type-coercion bug if CREA's JSON ever sends
    // this field as something other than a real boolean.
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing, InternetAddressDisplayYN: "true" }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    check(
      "InternetAddressDisplayYN as the STRING 'true' (not boolean) -> still NOT stored (strict boolean check, no coercion)",
      !params.includes("123 Main St, Brampton, ON L6Y 0A1")
    );
  }

  // --- 3b. listing_url NOT NULL hardening (added after initial deploy --
  // this was a real gap: the fix shipped 2026-07-25 without a dedicated
  // test, caught and closed same session). The D1 listing_url column is
  // NOT NULL. A missing ListingURL from CREA binding as null would throw a
  // constraint violation on that row -- and since writes go through
  // env.DB.batch() in chunks of 50 (see ingest.js), ONE bad row aborts the
  // WHOLE chunk's transaction, silently losing up to 49 other real
  // listings over a single missing field. Must fall back to "", never null.
  {
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing, ListingURL: undefined }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    // listing_url is bind position 11 (0-indexed) in buildUpsertStatement --
    // checked at that exact position, not via a whole-array scan, since
    // OTHER fields in this minimal fixture (PostalCode, Latitude, etc.)
    // are legitimately null and would make a blanket "no null anywhere"
    // check false-fail.
    const LISTING_URL_BIND_INDEX = 11;
    check(
      "missing ListingURL -> stored as empty string \"\" at its exact bind position, never null (D1 column is NOT NULL; null would abort the whole batch chunk this row is written in)",
      params[LISTING_URL_BIND_INDEX] === "",
      `got: ${JSON.stringify(params[LISTING_URL_BIND_INDEX])}`
    );
  }
  {
    const db = makeFakeDb();
    await dbModule.buildUpsertStatement(db, { ...baseListing, ListingURL: "www.realtor.ca/real-estate/12345/real-listing" }, "2026-01-01", null).run();
    const params = db.calls[0].params;
    const LISTING_URL_BIND_INDEX = 11;
    check(
      "a real ListingURL is stored as-is at its exact bind position, unaffected by the empty-string fallback",
      params[LISTING_URL_BIND_INDEX] === "www.realtor.ca/real-estate/12345/real-listing"
    );
  }

  // --- 4. getListingsByCity returns the new fields ---
  {
    const db = makeFakeDb();
    db.prepare = (sql) => ({
      bind: (...params) => ({
        all: async () => ({
          results: [{
            listing_key: "TEST1", list_price: 500000, city: "Brampton",
            postal_code: "L6Y", bedrooms: 3, bathrooms: 2, parking_total: 1,
            listing_url: "https://www.realtor.ca/real-estate/12345678",
            brokerage_name: "Test Realty", photos: "[]", last_updated: "2026-01-01",
            public_remarks: "A lovely home.", display_address: "123 Main St",
            year_built: 2015, lot_size_area: 40, lot_size_units: "ft",
          }],
        }),
      }),
    });
    const results = await dbModule.getListingsByCity(db, "Brampton", 20, null, 0);
    const r = results[0];
    check("getListingsByCity returns publicRemarks", r.publicRemarks === "A lovely home.");
    check("getListingsByCity returns displayAddress", r.displayAddress === "123 Main St");
    check("getListingsByCity returns yearBuilt", r.yearBuilt === 2015);
    check("getListingsByCity returns lotSizeArea and lotSizeUnits", r.lotSizeArea === 40 && r.lotSizeUnits === "ft");
  }

  // --- 5. Front-end: card never falls back to another field if displayAddress is absent ---
  const displaySrc = fs.readFileSync(path.join(__dirname, "..", "src", "listings-display.js"), "utf8");
  check(
    "renderListingCard uses listing.displayAddress directly, with no fallback to postalCode or another field if it's absent",
    /listing\.displayAddress\s*\?\s*escapeHtml\(listing\.displayAddress\)\s*:\s*null/.test(displaySrc)
  );
  check(
    "listing description (publicRemarks) is escaped via escapeHtml before insertion (XSS guard, same rule as brokerageName/city)",
    /listing\.publicRemarks\s*\?\s*escapeHtml\(listing\.publicRemarks\)/.test(displaySrc)
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
