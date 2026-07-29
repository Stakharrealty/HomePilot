// OriginatingSystemName production field test (2026-07-29).
//
// Why this exists: this is a real production ingestion behavior change --
// SELECT_FIELDS now requests OriginatingSystemName from CREA for every one
// of the 49 cities, every ingest run. Per the standing rule ("write a
// dedicated test for the specific change, not just rerun a few existing
// tests"), this test locks in exactly what changed and nothing more:
//   1. OriginatingSystemName is in SELECT_FIELDS and therefore in the
//      real $select sent to CREA via buildCityQuery()
//   2. The 6 confirmed-INVALID candidates from the 2026-07-29 /field-probe
//      run are NOT in SELECT_FIELDS (a regression here would 400 every
//      single city's ingest query)
//   3. A real CREA response carrying OriginatingSystemName flows correctly
//      through buildUpsertStatement() into the originating_system_name
//      column
//   4. The reporting queries (GROUP BY originating system) will now
//      actually have non-null data to group once ingest runs
//
// This test does NOT call CREA. Run: node tests/listings_originating_system_field_test.js

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

function makeFakeD1() {
  const rows = new Map();
  return {
    _rows: rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const colMatch = sql.match(/INSERT INTO listings \(([\s\S]*?)\)\s*VALUES/);
              const cols = colMatch[1].split(",").map((c) => c.trim());
              const row = {};
              cols.forEach((col, i) => { row[col] = args[i]; });
              rows.set(row.listing_key, row);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}

async function main() {
  const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);

  // --- 1. OriginatingSystemName is really in the query sent to CREA ---
  const cityParams = query.buildCityQuery("Toronto", 100, 0);
  const select = cityParams.get("$select") || "";
  check(
    "buildCityQuery's real $select includes OriginatingSystemName (field-probe-confirmed 2026-07-29)",
    select.split(",").includes("OriginatingSystemName")
  );

  // --- 2. The 6 confirmed-INVALID candidates are absent (would 400 every
  //     city's ingest query if accidentally added) ---
  const confirmedInvalid = [
    "OriginatingSystemKey", "SourceSystemName", "SourceSystemID",
    "SourceSystemKey", "MemberBoardKey",
  ];
  for (const field of confirmedInvalid) {
    check(
      `confirmed-INVALID field "${field}" (400 on live /field-probe) is NOT in the real $select`,
      !select.split(",").includes(field)
    );
  }
  // ListAgentKey was ALSO confirmed valid by the same probe run but
  // deliberately not added yet -- not needed for the board-attribution
  // question, and adding fields one at a time (not "everything that
  // passed the probe") keeps each production change reviewable on its own.
  check(
    "ListAgentKey (also confirmed valid, but not yet needed) was deliberately NOT added this change",
    !select.split(",").includes("ListAgentKey")
  );

  // --- 3. A real CREA row carrying this field flows through to D1 correctly ---
  const fakeDb = makeFakeD1();
  await db.upsertListing(fakeDb, {
    ListingKey: "OSN001", ListPrice: 800000, City: "Toronto",
    OriginatingSystemName: "Toronto Regional Real Estate Board",
  }, "2026-07-29T08:00:00.000Z", null);
  const row = fakeDb._rows.get("OSN001");
  check(
    "a real OriginatingSystemName value round-trips correctly into the originating_system_name column",
    row.originating_system_name === "Toronto Regional Real Estate Board"
  );

  // A row where CREA doesn't return it for some reason (shouldn't happen
  // now that it's in SELECT_FIELDS, but normalization must stay defensive)
  await db.upsertListing(fakeDb, { ListingKey: "OSN002", ListPrice: 500000, City: "Ottawa" }, "2026-07-29T08:00:00.000Z", null);
  check(
    "still defaults to NULL (not a guessed value) if a row genuinely lacks the field",
    fakeDb._rows.get("OSN002").originating_system_name === null
  );

  // --- 4. Reporting query now has a real column to group by ---
  const reporting = await import(pathToFileURL(path.join(SRC_DIR, "reporting.js")).href);
  check(
    "REPORTING_QUERIES.byOriginatingSystem still targets originating_system_name (unchanged by this addition)",
    /originating_system_name/.test(reporting.REPORTING_QUERIES.byOriginatingSystem)
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
