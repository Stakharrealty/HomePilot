// Automatic PropTx ingest (2026-09-18).
//
// Pulls every home for sale in each city in AUTO_INGEST_CITIES into D1,
// a few pages per cron run, remembering where it stopped in the
// proptx_ingest_state table. A city with thousands of listings can't be
// pulled in one Worker invocation (the first attempt hit Error 1102 on
// Mississauga), so each run does a small, bounded amount of work and the
// next run picks up from the saved cursor (PropTx's own @odata.nextLink).
//
// Per run, per city:
//   - not started / running -> process up to MAX_PAGES_PER_RUN pages, or
//     until TIME_BUDGET_MS is used up, saving the cursor after EVERY page
//     (so a killed run loses at most one page of progress)
//   - PropTx says no more pages -> status 'done'
//   - 'done' for REFRESH_AFTER_HOURS -> start over from page 1 (keeps
//     data inside PropTx Article 6.3's 24-hour refresh rule)
//   - a failing page leaves the cursor where it was and is retried next
//     run; MAX_CONSECUTIVE_ERRORS in a row -> status 'error', the city
//     stops until the next refresh window restarts it
//
// Scope: Mississauga, Hamilton, Guelph, Toronto (Toronto uses its own
// startswith filter -- see buildCityFilter() in proptx-ingest.js). More
// cities get added here as each is verified.

import { ingestCityPage } from "./proptx-ingest.js";

// Order matters: a run works through cities in this order until its time
// budget is spent, so the small cities go before Toronto (~9x Mississauga)
// and a Toronto refresh can never starve them. Each city resumes from its
// saved cursor, so Toronto spreads across many cron firings by design.
export const AUTO_INGEST_CITIES = ["Mississauga", "Hamilton", "Guelph", "Toronto"];
export const MAX_PAGES_PER_RUN = 20;
export const TIME_BUDGET_MS = 20000;
export const MAX_CONSECUTIVE_ERRORS = 5;
export const REFRESH_AFTER_HOURS = 12;

// Created on demand (IF NOT EXISTS) so no manual migration step is needed;
// the same statement is kept in migrations/0003_proptx_ingest_state.sql
// for the record.
export const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS proptx_ingest_state (
  city TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  next_link TEXT,
  pages_done INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  skipped_not_a_home INTEGER NOT NULL DEFAULT 0,
  mapping_errors INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_started_at TEXT,
  updated_at TEXT,
  finished_at TEXT
)`;

export async function ensureStateTable(db) {
  await db.prepare(STATE_TABLE_SQL).run();
}

export async function getState(db, city) {
  return db.prepare("SELECT * FROM proptx_ingest_state WHERE city = ?").bind(city).first();
}

async function saveState(db, s) {
  await db.prepare(`INSERT INTO proptx_ingest_state
      (city, status, next_link, pages_done, fetched, saved, skipped_not_a_home, mapping_errors,
       consecutive_errors, last_error, run_started_at, updated_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(city) DO UPDATE SET
      status = excluded.status, next_link = excluded.next_link, pages_done = excluded.pages_done,
      fetched = excluded.fetched, saved = excluded.saved, skipped_not_a_home = excluded.skipped_not_a_home,
      mapping_errors = excluded.mapping_errors, consecutive_errors = excluded.consecutive_errors,
      last_error = excluded.last_error, run_started_at = excluded.run_started_at,
      updated_at = excluded.updated_at, finished_at = excluded.finished_at`)
    .bind(s.city, s.status, s.next_link, s.pages_done, s.fetched, s.saved, s.skipped_not_a_home,
      s.mapping_errors, s.consecutive_errors, s.last_error, s.run_started_at, s.updated_at, s.finished_at)
    .run();
}

function freshState(city, nowIso) {
  return {
    city, status: "running", next_link: null, pages_done: 0, fetched: 0, saved: 0,
    skipped_not_a_home: 0, mapping_errors: 0, consecutive_errors: 0, last_error: null,
    run_started_at: nowIso, updated_at: nowIso, finished_at: null,
  };
}

/**
 * One bounded unit of work across AUTO_INGEST_CITIES. Safe to call as
 * often as the cron fires; a city that's done and fresh costs one D1 read.
 * `now` is injectable for tests (ms since epoch).
 */
export async function runAutoIngest(db, token, { now = () => Date.now(), cities = AUTO_INGEST_CITIES } = {}) {
  await ensureStateTable(db);
  const started = now();
  const summary = [];

  for (const city of cities) {
    let s = await getState(db, city);
    const nowIso = () => new Date(now()).toISOString();

    if (!s) {
      s = freshState(city, nowIso());
    } else if (s.status === "done" || s.status === "error") {
      const since = s.status === "done" ? s.finished_at : s.updated_at;
      const ageHours = since ? (now() - Date.parse(since)) / 3600000 : Infinity;
      if (ageHours < REFRESH_AFTER_HOURS) {
        summary.push({ city, action: "idle", status: s.status });
        continue;
      }
      s = freshState(city, nowIso());
    }

    let pagesThisRun = 0;
    while (pagesThisRun < MAX_PAGES_PER_RUN && now() - started < TIME_BUDGET_MS) {
      try {
        const r = await ingestCityPage(db, token, city, s.next_link);
        pagesThisRun++;
        s.pages_done += 1;
        s.fetched += r.fetchedThisPage;
        s.saved += r.upsertedThisPage;
        s.skipped_not_a_home += r.skippedNotAHomeCount || 0;
        s.mapping_errors += r.mappingErrorCount || 0;
        s.consecutive_errors = 0;
        s.last_error = null;
        s.next_link = r.nextLink;
        s.updated_at = nowIso();
        if (!r.nextLink) {
          s.status = "done";
          s.finished_at = s.updated_at;
        }
        await saveState(db, s);
        if (s.status === "done") break;
      } catch (e) {
        s.consecutive_errors += 1;
        s.last_error = String(e.message || e).slice(0, 500);
        s.updated_at = nowIso();
        if (s.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) s.status = "error";
        await saveState(db, s);
        break; // cursor untouched -- this page is retried next run
      }
    }
    summary.push({ city, action: "worked", pagesThisRun, status: s.status, pagesDone: s.pages_done });
    if (now() - started >= TIME_BUDGET_MS) break;
  }
  return summary;
}
