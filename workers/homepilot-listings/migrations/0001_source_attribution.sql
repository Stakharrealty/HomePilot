-- Migration 0001: source attribution columns for the DDF observability audit
-- (2026-07-28). Adds columns to `listings` so every future ingested row can
-- answer "where did this listing come from?" -- currently NOTHING in the
-- schema captures this (confirmed via PRAGMA table_info(listings) during
-- the audit that preceded this migration).
--
-- All columns are nullable TEXT, added via ADD COLUMN -- purely additive,
-- does not touch existing rows or any existing column. Existing rows will
-- have NULL in every new column until the next successful /ingest run
-- re-upserts them (upsertListing's ON CONFLICT clause will populate these
-- once the corresponding SELECT_FIELDS/normalization changes are live).
--
-- IMPORTANT: these columns are added ahead of the SELECT_FIELDS change on
-- purpose. Whether CREA's DDF Property entity actually exposes each of
-- these fields for this account is NOT yet confirmed (see
-- /field-probe in index.js, added in this same change) -- this codebase
-- has twice shipped an unconfirmed field name (DaysOnMarket, ListOfficeName)
-- straight into production $select and gotten a live 400 across the whole
-- ingest run. The columns existing early and staying NULL is harmless; a
-- bad field name in $select breaking every city's cron ingest is not.
--
-- ListOfficeKey is NOT added here -- it's already selected and used (for
-- the brokerage_name lookup in ingest.js) but was never itself persisted.
-- Adding it as a stored column too, since "brokerage_name resolved" and
-- "raw office key CREA gave us" are different facts worth keeping separate.

ALTER TABLE listings ADD COLUMN originating_system_name TEXT;
ALTER TABLE listings ADD COLUMN originating_system_key TEXT;
ALTER TABLE listings ADD COLUMN source_system_name TEXT;
ALTER TABLE listings ADD COLUMN list_office_key TEXT;
ALTER TABLE listings ADD COLUMN list_agent_key TEXT;
ALTER TABLE listings ADD COLUMN member_board_key TEXT;
