// Pagination ceiling test for homepilot-listings ingest.
//
// Why this exists: a live production audit (2026-07-28) queried D1 directly
// and found Ottawa's stored listing count was EXACTLY 2,000 -- i.e.
// MAX_PAGES_PER_CITY(20) * PAGE_SIZE(100). That's not a coincidence: it's
// the pagination safety wall in fetchListingsForCity() actually firing on
// real production data, meaning Ottawa's D1 rows were silently incomplete
// (CREA had more Active Single Family listings than we fetched). The
// `truncated` flag exists specifically to catch this but was true and
// nobody had looked -- this test locks in the fix (raising the ceiling)
// and, just as importantly, proves the safety wall itself still works so a
// genuinely runaway city can't hang a Worker invocation forever.
//
// This test does NOT call CREA. It mocks global.fetch and runs the REAL
// runIngest()/fetchListingsForCity() pagination loop from ingest.js against
// an in-memory fake D1 and a fake CREA token/Property/Office API.
//
// Run: node tests/listings_pagination_ceiling_test.js

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

// Minimal in-memory fake of D1's prepare().bind().run()/.batch() interface,
// just enough to let the real buildUpsertStatement()/deleteStaleListings()
// SQL from db.js execute against something.
function makeFakeD1() {
  const rows = new Map();
  function makeStmt(sql, args) {
    const isInsert = /^INSERT INTO listings/.test(sql);
    const isDelete = /^DELETE FROM listings/.test(sql);
    return {
      async run() {
        if (isInsert) {
          const [listing_key, , city] = args;
          rows.set(listing_key, { listing_key, city });
          return { meta: { changes: 1 } };
        }
        if (isDelete) {
          return { meta: { changes: 0 } };
        }
        throw new Error(`Fake D1: unrecognized SQL: ${sql.slice(0, 50)}`);
      },
    };
  }
  return {
    _rows: rows,
    prepare(sql) {
      return { bind: (...args) => makeStmt(sql, args) };
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}

// Fake CREA server. cityInventory maps city name -> total fake listing count
// CREA "has" for that city. Paginates in chunks of `pageSize` (mirrors
// CREA's real 100-row $top ceiling), same as the real API would.
function makeFakeFetch(cityInventory, pageSize) {
  return async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://identity.crea.ca/connect/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "fake-token" }) };
    }
    if (u.includes("/Office")) {
      return { ok: true, status: 200, json: async () => ({ value: [] }) };
    }
    if (u.includes("/Property")) {
      const params = new URLSearchParams(u.split("?")[1]);
      const top = parseInt(params.get("$top"), 10);
      const skip = parseInt(params.get("$skip"), 10);
      const filter = params.get("$filter") || "";
      const cityMatch = filter.match(/City eq '([^']+)'/);
      const city = cityMatch ? cityMatch[1] : null;
      const total = cityInventory[city] || 0;
      const remaining = Math.max(0, total - skip);
      const count = Math.min(top, remaining);
      const value = Array.from({ length: count }, (_, i) => ({
        ListingKey: `${city}-${skip + i}`,
        ListPrice: 500000,
        City: city,
      }));
      return { ok: true, status: 200, json: async () => ({ value }) };
    }
    return { ok: true, status: 200, json: async () => ({ value: [] }) };
  };
}

async function main() {
  const ingestSrc = fs.readFileSync(path.join(SRC_DIR, "ingest.js"), "utf8");

  // --- 1. Static: confirm PAGE_SIZE/MAX_PAGES_PER_CITY produce a ceiling
  //     strictly above 2,000 -- the exact value proven hit in production. ---
  const pageSizeMatch = ingestSrc.match(/const PAGE_SIZE\s*=\s*(\d+)/);
  const maxPagesMatch = ingestSrc.match(/const MAX_PAGES_PER_CITY\s*=\s*(\d+)/);
  check("PAGE_SIZE constant found in ingest.js", !!pageSizeMatch);
  check("MAX_PAGES_PER_CITY constant found in ingest.js", !!maxPagesMatch);
  const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 0;
  const maxPages = maxPagesMatch ? parseInt(maxPagesMatch[1], 10) : 0;
  const ceiling = pageSize * maxPages;
  check(
    `per-city ceiling (${ceiling}) is strictly greater than 2,000 (the value confirmed hit live for Ottawa)`,
    ceiling > 2000,
    `PAGE_SIZE=${pageSize} * MAX_PAGES_PER_CITY=${maxPages} = ${ceiling}`
  );
  check("CREA's confirmed real $top ceiling (100) is still respected", pageSize === 100);

  // --- 2. Functional: a city with 3,500 real listings (more than the old
  //     2,000 ceiling, less than the new one) must come back COMPLETE and
  //     NOT be marked truncated. ---
  const auth = await import(pathToFileURL(path.join(SRC_DIR, "auth.js")).href);
  const query = await import(pathToFileURL(path.join(SRC_DIR, "query.js")).href);
  const cities = await import(pathToFileURL(path.join(SRC_DIR, "cities.js")).href);
  void auth; void query;

  // ingest.js's internals (fetchListingsForCity, PAGE_SIZE, etc.) aren't
  // exported -- runIngest() is the real, only entry point (by design, see
  // the module header: "so there's exactly one code path to test"). Driving
  // the test through runIngest() itself, against every real HOMEPILOT_CITIES
  // entry, is what actually proves production behavior.
  const ingest = await import(pathToFileURL(path.join(SRC_DIR, "ingest.js")).href);

  const REALISTIC_OTTAWA_INVENTORY = 3500; // > old 2,000 ceiling, < new one
  const RUNAWAY_CITY = cities.HOMEPILOT_CITIES[1]; // any second real city name
  const RUNAWAY_INVENTORY = ceiling + 500; // deliberately over the new ceiling too

  const inventory = { Ottawa: REALISTIC_OTTAWA_INVENTORY, [RUNAWAY_CITY]: RUNAWAY_INVENTORY };

  const originalFetch = global.fetch;
  global.fetch = makeFakeFetch(inventory, pageSize);

  const fakeDb = makeFakeD1();
  const fakeEnv = { DB: fakeDb, DDF_CLIENT_ID: "x", DDF_CLIENT_SECRET: "y" };

  let result;
  try {
    result = await ingest.runIngest(fakeEnv);
  } finally {
    global.fetch = originalFetch;
  }

  const ottawaRowCount = [...fakeDb._rows.values()].filter((r) => r.city === "Ottawa").length;
  check(
    `Ottawa (3,500 fake listings, below new ceiling) is fetched COMPLETE, not capped at the old 2,000`,
    ottawaRowCount === REALISTIC_OTTAWA_INVENTORY,
    `expected ${REALISTIC_OTTAWA_INVENTORY}, got ${ottawaRowCount}`
  );
  check(
    "Ottawa is NOT in citiesTruncated now that its real inventory fits under the raised ceiling",
    !result.citiesTruncated.includes("Ottawa"),
    `citiesTruncated=${JSON.stringify(result.citiesTruncated)}`
  );

  // --- 3. Safety wall still works: a city with MORE than the new ceiling
  //     must still be marked truncated (not silently dropped, not allowed
  //     to run away unbounded). ---
  check(
    `a city genuinely exceeding the new ceiling (${RUNAWAY_CITY}) is still correctly flagged truncated`,
    result.citiesTruncated.includes(RUNAWAY_CITY),
    `citiesTruncated=${JSON.stringify(result.citiesTruncated)}`
  );
  const runawayRowCount = [...fakeDb._rows.values()].filter((r) => r.city === RUNAWAY_CITY).length;
  check(
    `truncated city still wrote exactly ${ceiling} rows (the safety wall, not zero, not unbounded)`,
    runawayRowCount === ceiling,
    `expected ${ceiling}, got ${runawayRowCount}`
  );

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
