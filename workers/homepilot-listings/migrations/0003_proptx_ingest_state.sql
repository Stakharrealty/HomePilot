-- Migration 0003: cursor/progress table for the automatic PropTx ingest
-- (2026-09-18). Record only -- src/proptx-auto-ingest.js creates this
-- table itself with CREATE TABLE IF NOT EXISTS on every run, so no manual
-- apply step is needed. Keep the two statements identical.
CREATE TABLE IF NOT EXISTS proptx_ingest_state (
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
);
