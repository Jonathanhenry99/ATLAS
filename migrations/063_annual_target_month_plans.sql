-- =====================================================================
-- 063 — The 12 months of each annual target version
--
-- brand_annual_target_revisions (migration 050) kept only a version's
-- totals, and the monthly split lives in brand_tracking_targets, which an
-- update overwrites. So once a target was adjusted, the plan it started
-- from — target awal per month — was gone, and Brand Tracking could not set
-- the plan awal, the adjusted plan and the actual sales side by side.
--
-- months: the 12 months as this version left them,
--   [{ "sales": 330833333, "spend": 61216667 }, ...] (January first; spend
--   null when the year has no budget). The newest version keeps following
--   the split edited in Brand Tracking until the next version is added, so
--   the baseline's months are the plan awal as it stood before the first
--   adjustment. NULL for versions saved before this migration.
--
-- Additive only; idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

ALTER TABLE brand_annual_target_revisions ADD COLUMN IF NOT EXISTS months JSONB;
