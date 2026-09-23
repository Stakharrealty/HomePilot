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
// startswith filter -- see buildCityFilter() in proptx-ingest.js), plus
// Halton Hills, King and Bradford West Gwillimbury. More cities get added
// here as each is verified.

import { ingestCityPage } from "./proptx-ingest.js";

// Order matters: a run works through cities in this order until its time
// budget is spent, so the small cities go before Toronto (~9x Mississauga)
// and a Toronto refresh can never starve them. Each city resumes from its
// saved cursor, so Toronto spreads across many cron firings by design.
// EVERY city HomePilot shows, with its live listing count measured against
// query.ampre.ca on 2026-09-22 (Active, For Sale, Residential). Before this
// list, 4 of 49 cities were ingested and the other 45 served a permanent
// empty state.
//
// Three kinds of name appear here, and the difference matters:
//   - most are HomePilot cities whose name PropTx uses verbatim
//   - Halton Hills / King / Bradford West Gwillimbury / Caledon are
//     MUNICIPALITIES that carry a card resolved through CITY_ALIASES
//     (Acton, Georgetown, King City, Bradford, Bolton), narrowed back to
//     the right community on the read path -- see communities.js
//   - East Luther Grand Valley is the Grand Valley card's real legal name
//   - Ottawa is ingested by county, not by city name (see buildCityFilter)
//
// ORDER IS LOAD-BEARING. A run works this list from the top until its time
// budget is spent, so it is sorted smallest-first with the two big markets
// last. Toronto (9,588) and Ottawa (3,779) are together a third of the feed;
// if either ran first its refresh would starve everything below it.
export const AUTO_INGEST_CITIES = [
  "East Luther Grand Valley",     //    46  is the Grand Valley card
  "Shelburne",                    //    78
  "Mono",                         //    79
  "Erin",                         //   132
  "Orangeville",                  //   136
  "Scugog",                       //   154
  "Cobourg",                      //   177
  "Midland",                      //   178
  "Bradford West Gwillimbury",    //   183  carries the Bradford card
  "Centre Wellington",            //   196
  "King",                         //   243  carries the King City card
  "Halton Hills",                 //   263  carries Acton + Georgetown
  "Ajax",                         //   284
  "Aurora",                       //   297
  "Newmarket",                    //   314
  "Belleville",                   //   323
  "Waterloo",                     //   335
  "Collingwood",                  //   342
  "Peterborough",                 //   349
  "Cambridge",                    //   356
  "Welland",                      //   363
  "Pickering",                    //   390
  "Whitby",                       //   404
  "Clarington",                   //   451
  "Fort Erie",                    //   458
  "Milton",                       //   464
  "Caledon",                      //   472  carries the Bolton card
  "Georgina",                     //   488
  "Wasaga Beach",                 //   490
  "Innisfil",                     //   495
  "Guelph",                       //   534
  "Niagara Falls",                //   573
  "Kitchener",                    //   583
  "St. Catharines",               //   588
  "Kingston",                     //   609
  "Oshawa",                       //   663
  "Burlington",                   //   669
  "Barrie",                       //   897
  "Richmond Hill",                //   975
  "Oakville",                     //  1013
  "Markham",                      //  1081
  "Vaughan",                      //  1236
  "Brampton",                     //  1766
  "Hamilton",                     //  1954
  "Mississauga",                  //  2343
  "Ottawa",                       //  3779  by county; 51 district names
  "Toronto",                      //  9588  by startswith; district-coded
];                                // ------
                                  // 37,791 listings across 47 ingest targets

// The two HomePilot cities deliberately absent: there are none. Every one
// of the 49 is reachable, either directly, through an alias, or as a
// community of a municipality above. The 2026-09-18 note that Ottawa and
// Grand Valley were "genuine zero-coverage cities (not a naming issue)" was
// wrong on both counts and is corrected in buildCityFilter and CITY_ALIASES.
export const MAX_PAGES_PER_RUN = 20;

// TIME_BUDGET_MS raised 20s -> 60s (2026-09-22, full-coverage rollout).
//
// The cron fires every 2 minutes, so the old budget used 20 of every 120
// seconds -- a 17% duty cycle. Measured against production on 2026-09-22,
// the four ingested cities took ~5 hours to work through 580 pages: 1.9
// pages/min, or about 4 pages per firing. At 20 pages allowed per run, the
// limiter was never MAX_PAGES_PER_RUN, it was this budget.
//
// That pace could not carry 47 cities. 37,791 listings at the old page size
// is 1,512 pages, which is ~13 hours per full pass -- against a 12h refresh
// window and a 36h staleness cutoff, that leaves no margin at all, and a
// busy spring market would push listings past the cutoff and empty the
// cities out. With PAGE_SIZE at 100 the same inventory is 378 pages, and
// 60s per firing brings a full pass to well under an hour.
//
// 60s, not 120s: a run must finish before the next firing or two runs can
// overlap on the same cursor. The budget is only checked BETWEEN pages, so
// a run can overshoot by one page (~1-3s). 60s leaves a full minute of
// slack for that overshoot plus any PropTx slowness.
export const TIME_BUDGET_MS = 60000;
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
