// DDF source-attribution audit test (2026-07-28).
//
// Covers everything added for "where did this listing come from?"
// observability:
//   1. migrations/0001_source_attribution.sql adds exactly the 6 expected
//      nullable columns, as pure ADD COLUMN statements (no destructive ops)
//   2. query.js's field-probe builder isolates ONE candidate field per
//      request (so a bad field name can't mask/be masked by another)
//   3. db.js's buildUpsertStatement() stores the new fields defensively
//      (present -> stored, absent -> NULL, never guessed/defaulted)
//   4. reporting.js's queries are syntactically real SQL that groups by
//      the right columns
//
// This test does NOT call CREA and does NOT touch production D1 -- it
// exercises the real exported functions against fixtures/an in-memory
// fake D1, same pattern as the rest of this suite.
//
// Run: node tests/listings_source_attribution_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");
const MIGRATIONS_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "migrations");

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
              // Parse the real column list out of the real INSERT statement
              // db.js issues, so this fixture breaks (loudly) if db.js's
              // column list and bind() arg order ever drift apart --
              // rather than silently mis-mapping values to columns.
              const colMatch = sql.match(/INSERT INTO listings \(([\s\S]*?)\)\s*VALUES/);
              if (!colMatch) throw new Error(`Fake D1: unrecognized SQL: ${sql.slice(0, 50)}`);
              const cols = colMatch[1].split(",").map((c) => c.trim());
              check.__lastCols = cols; // exposed for the test below to inspect
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
  // --- 1. Migration file: exactly the expected additive columns ---
  const migrationPath = path.join(MIGRATIONS_DIR, "0001_source_attribution.sql");
  check("migration file 0001_source_attribution.sql exists", fs.existsSync(migrationPath));
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  const expectedColumns = [
    "originating_system_name", "originating_system_key", "source_system_name",
    "list_office_key", "list_agent_key", "member_board_key",
  ];
  for (const col of expectedColumns) {
    check(
      `migration adds column "${col}" via ADD COLUMN (additive, not destructive)`,
      new RegExp(`ALTER TABLE listings ADD COLUMN ${col} TEXT`).test(migrationSql)
    );
  }
  check(
    "migration contains no destructive statement (DROP/DELETE/TRUNCATE)",
    !/\b(DROP|DELETE|TRUNCATE)\b/i.test(migrationSql)
  );

  // --- 2. query.js: candidate fields + isolated per-field probe query ---
  const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);

  check(
    "SOURCE_ATTRIBUTION_CANDIDATE_FIELDS is exported and non-empty",
    Array.isArray(query.SOURCE_ATTRIBUTION_CANDIDATE_FIELDS) && query.SOURCE_ATTRIBUTION_CANDIDATE_FIELDS.length > 0
  );
  check(
    "candidate list includes the real RESO standard fields the user asked about",
    ["OriginatingSystemName", "OriginatingSystemKey"].every((f) => query.SOURCE_ATTRIBUTION_CANDIDATE_FIELDS.includes(f))
  );

  const probeParams = query.buildFieldProbeQuery("OriginatingSystemName");
  const probeSelect = probeParams.get("$select") || "";
  check(
    "buildFieldProbeQuery selects ONLY ListingKey + the one candidate field (isolated, not batched)",
    probeSelect === "ListingKey,OriginatingSystemName"
  );
  check(
    "buildFieldProbeQuery does NOT smuggle in a second candidate field in the same request",
    !query.SOURCE_ATTRIBUTION_CANDIDATE_FIELDS.filter((f) => f !== "OriginatingSystemName").some((f) => probeSelect.includes(f))
  );
  check("buildFieldProbeQuery uses $top=1 (minimal live-data cost per probe)", probeParams.get("$top") === "1");

  // Confirm NONE of the candidate fields have been added to the real
  // production SELECT_FIELDS yet -- this is intentional (see the comment
  // on SOURCE_ATTRIBUTION_CANDIDATE_FIELDS in query.js): they must be
  // /field-probe-confirmed against live CREA data first. This test locks
  // that discipline in so a future edit can't silently skip the probe step.
  const querySrc = fs.readFileSync(path.join(SRC_DIR, "query.js"), "utf8");
  const selectFieldsMatch = querySrc.match(/const SELECT_FIELDS = \[([\s\S]*?)\];/);
  const selectFieldsBlock = selectFieldsMatch ? selectFieldsMatch[1] : "";
  for (const field of query.SOURCE_ATTRIBUTION_CANDIDATE_FIELDS) {
    check(
      `unconfirmed candidate "${field}" is NOT yet in production SELECT_FIELDS (must be /field-probe-confirmed first)`,
      !selectFieldsBlock.includes(`"${field}"`)
    );
  }

  // --- 3. index.js: /field-probe route exists and is wired up ---
  const indexSrc = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");
  check(
    "index.js defines the /field-probe route",
    /url\.pathname === "\/field-probe"/.test(indexSrc)
  );
  check(
    "index.js imports SOURCE_ATTRIBUTION_CANDIDATE_FIELDS and buildFieldProbeQuery from query.js",
    /SOURCE_ATTRIBUTION_CANDIDATE_FIELDS/.test(indexSrc) && /buildFieldProbeQuery/.test(indexSrc)
  );
  check(
    "/field-probe makes NO D1 writes (read-only diagnostic -- no env.DB call in that block)",
    (() => {
      const start = indexSrc.indexOf('url.pathname === "/field-probe"');
      // End at the NEXT route definition after /field-probe, whatever it
      // is -- not a hardcoded route name, so this stays correct as routes
      // are added/reordered (this exact test broke once already, 2026-07-28,
      // when /ingest-probe was inserted between /field-probe and /ingest).
      const nextRouteMatch = indexSrc.slice(start + 10).match(/if \(url\.pathname === "\/[a-z-]+"\)/);
      const end = nextRouteMatch ? start + 10 + nextRouteMatch.index : indexSrc.length;
      const block = indexSrc.slice(start, end);
      // Requires an actual "env.DB." property/method access (real code),
      // not just the substring "env.DB" -- a prose comment mentioning
      // "env.DB calls" (e.g. describing a NEIGHBORING route) would
      // otherwise false-positive here. Confirmed as a real false positive
      // 2026-07-28 when /ingest-probe's own doc-comment ("Makes zero
      // env.DB calls...") got included in this block by the boundary
      // slice and tripped the old loose regex.
      return !/env\.DB\./.test(block);
    })()
  );

  // --- 4. db.js: buildUpsertStatement stores new fields defensively ---
  const db = await import(pathToFileURL(path.join(SRC_DIR, "db.js")).href);
  const fakeDb = makeFakeD1();
  const runTime = "2026-07-28T08:00:00.000Z";

  // 4a. A listing where CREA returns the attribution fields
  await db.upsertListing(fakeDb, {
    ListingKey: "SRC001", ListPrice: 900000, City: "Toronto",
    OriginatingSystemName: "TRREB", OriginatingSystemKey: "TRREB-123",
    SourceSystemName: "CREA-DDF", ListOfficeKey: "OFF1", ListAgentKey: "AGT1",
    MemberBoardKey: "MB1",
  }, runTime, "Some Brokerage");

  const row1 = fakeDb._rows.get("SRC001");
  check("originating_system_name stored when CREA provides it", row1.originating_system_name === "TRREB");
  check("originating_system_key stored when CREA provides it", row1.originating_system_key === "TRREB-123");
  check("source_system_name stored when CREA provides it", row1.source_system_name === "CREA-DDF");
  check("list_office_key stored (raw key, separate from resolved brokerage_name)", row1.list_office_key === "OFF1");
  check("list_agent_key stored when CREA provides it", row1.list_agent_key === "AGT1");
  check("member_board_key stored when CREA provides it", row1.member_board_key === "MB1");
  check("brokerage_name (existing field) still populated correctly alongside new fields", row1.brokerage_name === "Some Brokerage");

  // 4b. A listing where CREA does NOT return these fields (today's real
  // production reality, since SELECT_FIELDS doesn't request them yet) --
  // must be NULL, never a guessed/defaulted value.
  await db.upsertListing(fakeDb, {
    ListingKey: "SRC002", ListPrice: 500000, City: "Ottawa",
  }, runTime, null);

  const row2 = fakeDb._rows.get("SRC002");
  check("originating_system_name is NULL (not guessed) when CREA doesn't provide it", row2.originating_system_name === null);
  check("member_board_key is NULL (not guessed) when CREA doesn't provide it", row2.member_board_key === null);
  check("list_agent_key is NULL (not guessed) when CREA doesn't provide it", row2.list_agent_key === null);

  // --- 5. reporting.js: queries are well-formed and group by the right columns ---
  const reporting = await import(pathToFileURL(path.join(SRC_DIR, "reporting.js")).href);
  check("REPORTING_QUERIES.bySourceBoard groups by member_board_key", /GROUP BY source_board/.test(reporting.REPORTING_QUERIES.bySourceBoard) && /member_board_key/.test(reporting.REPORTING_QUERIES.bySourceBoard));
  check("REPORTING_QUERIES.byOriginatingSystem groups by originating_system_name", /originating_system_name/.test(reporting.REPORTING_QUERIES.byOriginatingSystem));
  check("REPORTING_QUERIES.byCity groups by city", /GROUP BY\s+city/.test(reporting.REPORTING_QUERIES.byCity));
  check("REPORTING_QUERIES.byBrokerage groups by brokerage_name", /brokerage_name/.test(reporting.REPORTING_QUERIES.byBrokerage));
  const combined = reporting.REPORTING_QUERIES.cityBySourceTemplate(2);
  check("cityBySourceTemplate(2) produces exactly 2 bind placeholders", (combined.match(/\?/g) || []).length === 2);
  check("cityBySourceTemplate groups by city, originating_system, source_board together", /GROUP BY city, originating_system, source_board/.test(combined));

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
