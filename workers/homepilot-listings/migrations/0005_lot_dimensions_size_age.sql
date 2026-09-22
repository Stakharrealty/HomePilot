-- Migration 0005: lot dimensions, living area range, and building age --
-- confirmed via a live field-availability investigation (2026-09-22) using
-- a temporary read-only diagnostic route against PropTx's real $metadata
-- and a 1,090-listing live sample across 23 cities (route removed after
-- the investigation; findings captured in chat/report, not left running).
--
-- All columns nullable TEXT/REAL, added via ADD COLUMN -- purely additive,
-- does not touch existing rows or any existing column. Applied the same
-- way migrations 0001-0004 were (direct `wrangler d1 execute --file=`,
-- not the tracked migrations system -- this D1 database has never used
-- that tracking table).
--
-- lot_width / lot_depth (RESO LotWidth/LotDepth, Edm.Double): confirmed
-- 100% populated on every lot-bearing subtype in the live sample (Detached
-- 181/181, Semi-Detached 17/17, Att/Row/Townhouse 24/24), correctly 0% on
-- condos. Replaces the existing lot_size_area column as the PRIMARY lot
-- size signal for display -- lot_size_area is confirmed only 11% populated
-- overall (19% on Detached) and is NOT removed here: it has exactly one
-- other reader (fullListingFacts() in src/listing-detail.js, no
-- calculation dependency), which now prefers width x depth and falls back
-- to lot_size_area only when width/depth are both absent.
ALTER TABLE listings ADD COLUMN lot_width REAL;
ALTER TABLE listings ADD COLUMN lot_depth REAL;
-- lot_size_source (RESO LotSizeSource, Edm.String): confirmed populated
-- 41% overall (56% on Detached), real values seen: "MPAC", "GeoWarehouse".
-- Stored for completeness; not currently displayed (product decision:
-- listing.html shows the dimensions, not their provenance).
ALTER TABLE listings ADD COLUMN lot_size_source TEXT;

-- living_area_range (RESO LivingAreaRange, Edm.String): confirmed 93%
-- populated overall, 100% on every real home subtype (Detached, Condo
-- Apartment, Condo Townhouse, Att/Row/Townhouse, Semi-Detached) in the live
-- sample. A bucketed range string ("3000-3500", "800-899", "< 700"), NOT
-- an exact square footage -- PropTx does not provide an exact number
-- (LivingArea/BuildingAreaTotal confirmed not populated). This is the
-- correct, working field; do not attempt to add an "exact sqft" column.
ALTER TABLE listings ADD COLUMN living_area_range TEXT;

-- approximate_age (RESO ApproximateAge, Edm.String): confirmed 41%
-- populated in the live sample (600 listings, 15 cities), across Detached,
-- Semi-Detached, Duplex, Multiplex, Condo Apartment, Condo Townhouse. A
-- bucketed range string ("0-5", "6-15", "16-30", "31-50", "100+", "New"),
-- NOT an exact year -- the exact YearBuilt field is confirmed 0/1,090
-- populated across every property type and city sampled; do not use it as
-- a primary source. (year_built/YearBuilt stays in the schema and ingest
-- untouched -- it just stays empty, same as today.)
ALTER TABLE listings ADD COLUMN approximate_age TEXT;
