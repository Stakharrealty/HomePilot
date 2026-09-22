// Automatic PropTx ingest test (2026-09-18).
//
// proptx-auto-ingest.js pulls a whole city a few pages per cron firing,
// saving a cursor between firings. This runs it against real SQLite (via a
// D1-shaped wrapper, including db.batch) and a fake PropTx that serves a
// 7-page city with real labels, across simulated cron firings.
//
// What this proves:
//   1. First firing: creates the state table, does at most
//      MAX_PAGES_PER_RUN pages, saves the cursor.
//   2. Later firings resume from the saved cursor -- never restart, never
//      re-fetch a page already done.
//   3. The city finishes: status 'done', every home saved exactly once,
//      every non-home skipped, counters add up.
//   4. Done and fresh: a firing makes ZERO PropTx calls.
//   5. Done for REFRESH_AFTER_HOURS: starts over from page 1 (24h rule).
//   6. A failing page leaves the cursor alone and is retried; 5 failures
//      in a row -> status 'error'; one success resets the error count.
//   7. The time budget stops a run between pages.
//   8. The scheduled() handler runs it; wrangler has exactly one cron (so
//      two runs can't race on one cursor); the dangerous
//      /proptx-reset-test-rows route and the manual test route are gone.
//
// Run: node --no-warnings tests/listings_proptx_auto_ingest_test.js

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const WORKER_DIR = path.join(__dirname, "..", "workers", "homepilot-listings");
const SRC_DIR = path.join(WORKER_DIR, "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

// --- D1-shaped wrapper over real node:sqlite. Adds missing columns to
// `listings` on the fly so the test doesn't hard-code the ingest's column
// list (the real table already has them all).
function makeD1(sqlite) {
  function ensureListingColumns(sql) {
    const m = sql.match(/INSERT INTO listings \(([^)]*)\)/);
    if (!m) return;
    const have = new Set(sqlite.prepare("PRAGMA table_info(listings)").all().map((c) => c.name));
    for (const c of m[1].split(",").map((x) => x.trim())) {
      if (!have.has(c)) sqlite.exec(`ALTER TABLE listings ADD COLUMN ${c}`);
    }
  }
  function stmt(sql, args = []) {
    return {
      sql, args,
      bind(...a) { return stmt(sql, a); },
      async run() { ensureListingColumns(sql); sqlite.prepare(sql).run(...args); return { success: true }; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    };
  }
  return {
    prepare(sql) { return stmt(sql); },
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try { for (const s of stmts) { ensureListingColumns(s.sql); sqlite.prepare(s.sql).run(...s.args); } sqlite.exec("COMMIT"); }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
      return stmts.map(() => ({ success: true }));
    },
  };
}

// --- Fake PropTx: 7 pages of 25 (last page short). Every 5th listing is a
// non-home. nextLink carries a page number.
const PAGES = 7;
function listingsForPage(n) {
  const count = n === PAGES ? 10 : 25;
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = (n - 1) * 25 + i;
    const sub = idx % 5 === 4 ? "Parking Space" : ["Detached", "Condo Apartment", "Semi-Detached ", "Att/Row/Townhouse"][idx % 4];
    out.push({ ListingKey: `M${idx}`, ListPrice: 700000 + idx, City: "Mississauga", StandardStatus: "Active",
      TransactionType: "For Sale", PropertySubType: sub, Media: [] });
  }
  return out;
}
const TOTAL = (PAGES - 1) * 25 + 10;
const EXPECTED_NON_HOMES = Array.from({ length: TOTAL }, (_, i) => i).filter((i) => i % 5 === 4).length;

function makeFakePropTx(log, failPages = new Set()) {
  return async (url) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") || "1");
    log.push(page);
    if (failPages.has(page)) return new Response("boom", { status: 503 });
    const body = { value: listingsForPage(page) };
    if (page < PAGES) body["@odata.nextLink"] = `https://query.ampre.ca/odata/Property?page=${page + 1}`;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

(async () => {
  const auto = await import(pathToFileURL(path.join(SRC_DIR, "proptx-auto-ingest.js")).href);
  check("scope is Mississauga, Hamilton, Guelph, Toronto (Toronto last)", JSON.stringify(auto.AUTO_INGEST_CITIES) === JSON.stringify(["Mississauga", "Hamilton", "Guelph", "Toronto"]));
  // The behavior checks below exercise one city at a time so page sequences stay readable.
  const ONE_CITY = { cities: ["Mississauga"] };

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE listings (listing_key TEXT PRIMARY KEY)");
  const db = makeD1(sqlite);

  // Fake clock. Each call advances 10ms so time budget math is exercised.
  let clock = Date.parse("2026-09-19T00:00:00Z");
  const now = () => (clock += 10);

  const realFetch = globalThis.fetch;
  const log = [];
  globalThis.fetch = makeFakePropTx(log);
  const MAX = auto.MAX_PAGES_PER_RUN;

  try {
    // Use a small page cap for this test so resume is exercised over
    // several firings: temporarily run with cities override + many firings.
    // 1. First firing
    const r1 = await auto.runAutoIngest(db, "tok", { now, ...ONE_CITY });
    const st1 = await auto.getState(db, "Mississauga");
    const pagesFirst = Math.min(MAX, PAGES);
    check("first firing does at most MAX_PAGES_PER_RUN pages", log.length === pagesFirst, `fetched pages ${JSON.stringify(log)}`);
    check("state row created with progress saved", st1 && st1.pages_done === pagesFirst);

    // With MAX (20) >= 7 pages, one firing finishes the fake city. To also
    // prove resume, run a second scenario below with a tight time budget.
    check("city finishes: status 'done'", st1.status === "done", st1.status);
    check("next_link cleared when done", st1.next_link === null);
    const homes = sqlite.prepare("SELECT COUNT(*) AS n FROM listings").get().n;
    check(`every home saved exactly once (${TOTAL - EXPECTED_NON_HOMES})`, homes === TOTAL - EXPECTED_NON_HOMES, `${homes}`);
    check("no non-home saved", sqlite.prepare("SELECT COUNT(*) AS n FROM listings WHERE TRIM(property_subtype) = 'Parking Space'").get().n === 0);
    check("counters add up (fetched = saved + skipped)", st1.fetched === TOTAL && st1.saved + st1.skipped_not_a_home === TOTAL && st1.skipped_not_a_home === EXPECTED_NON_HOMES,
      JSON.stringify({ f: st1.fetched, s: st1.saved, k: st1.skipped_not_a_home }));
    check("trailing-space semi stored exactly as sent", sqlite.prepare("SELECT COUNT(*) AS n FROM listings WHERE property_subtype = 'Semi-Detached '").get().n > 0);
    check("rows tagged source PROPTX", sqlite.prepare("SELECT COUNT(*) AS n FROM listings WHERE source = 'PROPTX'").get().n === homes);

    // 4. Done and fresh -> zero PropTx calls
    log.length = 0;
    clock += 60 * 60 * 1000; // +1h
    const r2 = await auto.runAutoIngest(db, "tok", { now, ...ONE_CITY });
    check("done + fresh: zero PropTx calls", log.length === 0, `${log.length}`);
    check("done + fresh: reported idle", r2[0].action === "idle");

    // 5. Done for REFRESH_AFTER_HOURS -> restart from page 1
    clock += auto.REFRESH_AFTER_HOURS * 3600 * 1000;
    const r3 = await auto.runAutoIngest(db, "tok", { now, ...ONE_CITY });
    check("after REFRESH_AFTER_HOURS: restarts from page 1", log[0] === 1 && log.length === PAGES, JSON.stringify(log));
    check("refresh re-upserts, no duplicate rows", sqlite.prepare("SELECT COUNT(*) AS n FROM listings").get().n === homes);

    // 2 + 7. Resume across firings using the time budget to stop early.
    const sqlite2 = new DatabaseSync(":memory:");
    sqlite2.exec("CREATE TABLE listings (listing_key TEXT PRIMARY KEY)");
    const db2 = makeD1(sqlite2);
    let clock2 = Date.parse("2026-09-19T00:00:00Z");
    // Each clock read advances 3s: budget 20s allows only a few pages per firing.
    const slowNow = () => (clock2 += 3000);
    log.length = 0;
    const firings = [];
    for (let i = 0; i < 10; i++) {
      const before = log.length;
      await auto.runAutoIngest(db2, "tok", { now: slowNow, ...ONE_CITY });
      firings.push(log.slice(before));
      const st = await auto.getState(db2, "Mississauga");
      if (st.status === "done") break;
    }
    const allPages = firings.flat();
    check("time budget stops a firing early (more than one firing needed)", firings.length > 1, JSON.stringify(firings));
    check("each firing resumes where the last stopped (pages fetched in order, none repeated)",
      JSON.stringify(allPages) === JSON.stringify(Array.from({ length: PAGES }, (_, i) => i + 1)), JSON.stringify(allPages));
    const st2 = await auto.getState(db2, "Mississauga");
    check("resumed city finishes with all homes", st2.status === "done" &&
      sqlite2.prepare("SELECT COUNT(*) AS n FROM listings").get().n === TOTAL - EXPECTED_NON_HOMES);

    // 6. Errors: page 3 fails
    const sqlite3 = new DatabaseSync(":memory:");
    sqlite3.exec("CREATE TABLE listings (listing_key TEXT PRIMARY KEY)");
    const db3 = makeD1(sqlite3);
    let clock3 = Date.parse("2026-09-19T00:00:00Z");
    const now3 = () => (clock3 += 10);
    const log3 = [];
    const failing = new Set([3]);
    globalThis.fetch = makeFakePropTx(log3, failing);
    await auto.runAutoIngest(db3, "tok", { now: now3, ...ONE_CITY });
    let st3 = await auto.getState(db3, "Mississauga");
    check("failing page: cursor stays on that page", st3.pages_done === 2 && /page=3/.test(st3.next_link), JSON.stringify({ p: st3.pages_done, n: st3.next_link }));
    check("failing page: error recorded, status still running", st3.consecutive_errors === 1 && st3.status === "running" && /503/.test(st3.last_error));
    for (let i = 0; i < 3; i++) await auto.runAutoIngest(db3, "tok", { now: now3, ...ONE_CITY });
    st3 = await auto.getState(db3, "Mississauga");
    check("4 failures in a row: still running", st3.consecutive_errors === 4 && st3.status === "running");
    failing.clear();
    await auto.runAutoIngest(db3, "tok", { now: now3, ...ONE_CITY });
    st3 = await auto.getState(db3, "Mississauga");
    check("a success resets the error count and continues from page 3", st3.consecutive_errors === 0 && st3.last_error === null && st3.status === "done");

    const sqlite4 = new DatabaseSync(":memory:");
    sqlite4.exec("CREATE TABLE listings (listing_key TEXT PRIMARY KEY)");
    const db4 = makeD1(sqlite4);
    globalThis.fetch = makeFakePropTx([], new Set([1]));
    for (let i = 0; i < auto.MAX_CONSECUTIVE_ERRORS; i++) await auto.runAutoIngest(db4, "tok", { now: now3, ...ONE_CITY });
    const st4 = await auto.getState(db4, "Mississauga");
    check(`${auto.MAX_CONSECUTIVE_ERRORS} failures in a row: status 'error'`, st4.status === "error", st4.status);
    const log4 = [];
    globalThis.fetch = makeFakePropTx(log4);
    await auto.runAutoIngest(db4, "tok", { now: now3, ...ONE_CITY });
    check("'error' city waits (no calls) until the refresh window", log4.length === 0);

    // 8. Wiring
    const worker = (await import(pathToFileURL(path.join(SRC_DIR, "index.js")).href)).default;
    const waited = [];
    const sqlite5 = new DatabaseSync(":memory:");
    sqlite5.exec("CREATE TABLE listings (listing_key TEXT PRIMARY KEY)");
    const log5 = [];
    globalThis.fetch = makeFakePropTx(log5);
    await worker.scheduled({ cron: "*/2 * * * *" }, { DB: makeD1(sqlite5), PROPTX_IDX_TOKEN: "tok" }, { waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    check("scheduled() runs the auto-ingest via waitUntil", waited.length === 1 && log5.length > 0);
    const noTok = [];
    await worker.scheduled({ cron: "*/2 * * * *" }, { DB: makeD1(sqlite5) }, { waitUntil: (p) => noTok.push(p) });
    check("scheduled() does nothing without the PropTx token", noTok.length === 0);

    const wr = fs.readFileSync(path.join(WORKER_DIR, "wrangler.jsonc"), "utf8");
    const crons = wr.match(/"crons":\s*\[([^\]]*)\]/);
    check("wrangler has exactly one cron, every 2 minutes", crons && crons[1].trim() === '"*/2 * * * *"', crons && crons[1]);

    const idx = fs.readFileSync(path.join(SRC_DIR, "index.js"), "utf8");
    check("/proptx-reset-test-rows route removed", !idx.includes('"/proptx-reset-test-rows"'));
    check("no DELETE statement anywhere in index.js", !/DELETE\s+FROM/i.test(idx));
    check("manual /proptx-ingest-test-mississauga route removed", !idx.includes('"/proptx-ingest-test-mississauga"'));

    // The /proptx-ingest-status route was removed on 2026-09-22 (audit). It
    // was unauthenticated and ran roughly six D1 queries per configured city
    // per request, and it disclosed ingest state and error strings. Progress is
    // still readable with `wrangler d1 execute` against proptx_ingest_state.
    // What is asserted now is that it stays gone and touches nothing.
    const sqlite6 = new DatabaseSync(":memory:");
    sqlite6.exec(`CREATE TABLE listings (listing_key TEXT PRIMARY KEY, city TEXT, source TEXT, transaction_type TEXT, property_subtype TEXT)`);
    sqlite6.exec(`INSERT INTO listings VALUES ('A','Mississauga','PROPTX','For Sale','Detached'),('B','Mississauga','PROPTX','For Sale','Parking Space')`);
    const touched = [];
    const d6 = makeD1(sqlite6);
    const spy = { prepare(sql) { touched.push(sql); return d6.prepare(sql); } };
    const resp = await worker.fetch(new Request("https://w.example/proptx-ingest-status"), { DB: spy });
    check("ingest-status route is no longer publicly reachable", resp.status === 404, `status ${resp.status}`);
    check("the removed status route runs no D1 queries", touched.length === 0, `${touched.length} queries`);
    check("ingest-status route removed from index.js", !idx.includes('"/proptx-ingest-status"'));
    check("the removed status route writes nothing",
      !touched.some((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)), JSON.stringify(touched));
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
