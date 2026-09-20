-- Migration 0004: MLS number + listed date for the redesigned listing card.
--
-- mls_number: PropTx's public listing ID (RESO ListingId, e.g. "W1234567"),
--   distinct from listing_key (ListingKey, the internal record ID used in
--   ?key= URLs).
-- listed_date: when the listing went on the market (PropTx OriginalEntryTimestamp; ListingContractDate is always null in the IDX feed).
--
-- Purely additive and nullable. Existing rows stay NULL until the next ingest
-- refresh upserts them; the card omits the MLS segment / listed date when NULL.
-- Never guessed if PropTx doesn't supply them.
--
-- APPLY THIS BEFORE deploying the worker that selects/writes these columns
-- (the ingest upsert and the /listings SELECT would fail on a missing column).
ALTER TABLE listings ADD COLUMN mls_number TEXT;
ALTER TABLE listings ADD COLUMN listed_date TEXT;
