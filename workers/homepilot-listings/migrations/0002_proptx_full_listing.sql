-- Migration 0002: full listing detail columns for PropTx IDX ingest
-- (2026-09-18). Adds everything needed to show a complete, verbatim
-- listing (per PropTx Article 6.3(f) -- content may be reformatted by
-- choosing which fields to show, but never altered) plus HomePilot's own
-- per-listing affordability breakdown on top of it.
--
-- All columns are nullable, added via ADD COLUMN -- purely additive, does
-- not touch existing rows or any existing column. The `listings` table is
-- currently empty (DDF fully removed 2026-09-18), so there is no existing
-- data to migrate or backfill.
--
-- source (new): marks which pipeline wrote this row. Every future row
-- from the PropTx ingest module sets this to 'PROPTX'. Lets a future
-- unsubscribe/termination cleanup (PropTx Article 12.6 -- IDX Data must
-- be securely deleted on termination) be a plain
-- `DELETE FROM listings WHERE source = 'PROPTX'` instead of a guess.
ALTER TABLE listings ADD COLUMN source TEXT;

-- city_district (new): PropTx splits Toronto into TRREB district codes
-- (e.g. "Toronto C07", "Toronto W04") rather than storing a plain
-- "Toronto" City value (confirmed live 2026-09-18 -- see
-- provinceWideActiveCount / torontoStartswithCount investigation).
-- Decision: keep the full PropTx City value ("Toronto C07") in the
-- existing `city` column as before, AND additionally store just the
-- district code alone here, so a future feature can map HomePilot's
-- existing Toronto sub-region display cards (Downtown, West End, North
-- York, Etobicoke, Scarborough -- see CITY_ALIASES in cities.js) to their
-- real PropTx district instead of one shared bucket. NULL for every
-- non-Toronto row.
ALTER TABLE listings ADD COLUMN city_district TEXT;

-- Full listing content -- shown verbatim per Article 6.3(f), never
-- edited/reworded by HomePilot. All TEXT/nullable; ingest either gets
-- the real PropTx value or leaves it NULL (never a guessed fallback).
ALTER TABLE listings ADD COLUMN public_remarks_full TEXT;        -- PropTx PublicRemarks, full/uncut (existing public_remarks column may already hold a truncated version -- kept separate rather than overwritten, to avoid an ambiguous migration of an existing column's meaning)
ALTER TABLE listings ADD COLUMN photos_full TEXT;                -- JSON array of every PUBLIC-permission Media URL for this listing (confirmed 2026-09-18: PropTx Media entries include a "Permission" field -- some variants are marked Private and must never be used here, only "Public" ones)
ALTER TABLE listings ADD COLUMN property_sub_type TEXT;          -- NOTE (caught after applying live): the existing schema already has `property_subtype` (no underscore). This column is a redundant near-duplicate this migration should not have introduced -- the real ingest module should write PropTx's PropertySubType into the EXISTING `property_subtype` column instead. Left in place since D1 doesn't support dropping a column without a table rebuild; just don't write to it.
ALTER TABLE listings ADD COLUMN transaction_type TEXT;           -- PropTx TransactionType (Sale/Lease)
ALTER TABLE listings ADD COLUMN standard_status TEXT;            -- PropTx StandardStatus (Active/etc.) -- for ingest's own filtering/audit, not necessarily displayed
ALTER TABLE listings ADD COLUMN association_fee REAL;            -- condo/association fee -- REAL DATA from PropTx (confirmed populated on condo listings, correctly NULL on freehold), never HomePilot-estimated when present
ALTER TABLE listings ADD COLUMN association_fee_frequency TEXT;  -- Monthly/Annually/etc.
ALTER TABLE listings ADD COLUMN tax_annual_amount REAL;          -- PropTx TaxAnnualAmount, when present (confirmed populated, e.g. $21,197 on a real sample listing) -- HomePilot only estimates tax when this is NULL
ALTER TABLE listings ADD COLUMN tax_year INTEGER;
ALTER TABLE listings ADD COLUMN heat_type TEXT;
ALTER TABLE listings ADD COLUMN cooling TEXT;
ALTER TABLE listings ADD COLUMN basement TEXT;
ALTER TABLE listings ADD COLUMN garage_type TEXT;
ALTER TABLE listings ADD COLUMN parking_spaces INTEGER;          -- distinct from existing parking_total -- PropTx separates ParkingSpaces/GarageParkingSpaces/CoveredSpaces; existing parking_total's exact prior meaning under DDF is unconfirmed, so not overwritten
ALTER TABLE listings ADD COLUMN virtual_tour_url TEXT;           -- confirmed present on real sample listing (VirtualTourURLBranded)
-- list_agent_full_name intentionally NOT added: confirmed via a 100-listing
-- real sample (5 cities, 2026-09-18) that PropTx's ListAgentFullName field
-- is empty on 100% of listings through this IDX feed. Article 6.3(c) only
-- requires the listing BROKERAGE to be displayed, not the individual
-- agent, so this is not a compliance gap -- just a field that doesn't
-- exist in the data HomePilot actually receives. Do not add a column for
-- it or design any UI element assuming it will be populated.
ALTER TABLE listings ADD COLUMN list_office_name TEXT;           -- confirmed populated on 100% of a 100-listing real sample -- required display per Article 6.3(c)
ALTER TABLE listings ADD COLUMN list_aor TEXT;                   -- which board/association this listing actually belongs to
ALTER TABLE listings ADD COLUMN modification_timestamp TEXT;     -- PropTx's own last-modified time, distinct from HomePilot's last_updated ingest timestamp -- used for incremental sync

-- Deliberately NOT added, per product decision not to store fields just
-- because PropTx happens to expose them: zoning, inclusions/exclusions,
-- possession details, and the ~250 other Property fields seen in the
-- $metadata schema (farm/commercial/industrial-specific fields, internal
-- system keys, fax numbers, etc.) that don't serve either the listing
-- display or HomePilot's own cost breakdown for a residential buyer.
