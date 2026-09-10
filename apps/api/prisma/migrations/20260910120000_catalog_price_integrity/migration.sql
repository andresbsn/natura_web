-- Catalog/campaign periods use half-open [startsAt, endsAt) semantics.
-- Order and OrderItem snapshot columns are intentionally untouched: historical
-- order prices, discounts, names, SKUs, and totals remain immutable.

BEGIN;

-- Fail rather than silently changing invalid catalog business data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Catalog"
    WHERE "startsAt" >= "endsAt"
  ) THEN
    RAISE EXCEPTION 'Cannot enforce catalog periods: startsAt must be before endsAt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Catalog" first_catalog
    JOIN "Catalog" second_catalog
      ON first_catalog."id" < second_catalog."id"
     AND first_catalog."isActive"
     AND second_catalog."isActive"
     AND tsrange(first_catalog."startsAt", first_catalog."endsAt", '[)')
         && tsrange(second_catalog."startsAt", second_catalog."endsAt", '[)')
  ) THEN
    RAISE EXCEPTION 'Cannot enforce active catalog periods: existing active catalogs overlap';
  END IF;
END $$;

ALTER TABLE "Catalog"
  ADD CONSTRAINT "Catalog_valid_period_check"
  CHECK ("startsAt" < "endsAt");

-- Adjacent active periods are allowed because tsrange uses [) bounds.
-- Inactive catalogs may overlap; activating one is checked by this constraint.
ALTER TABLE "Catalog"
  ADD CONSTRAINT "Catalog_active_period_excl"
  EXCLUDE USING GIST (
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("isActive");

CREATE INDEX "Catalog_isActive_startsAt_endsAt_idx"
  ON "Catalog"("isActive", "startsAt", "endsAt");

-- PostgreSQL treats NULL values as distinct in the existing composite unique
-- index. Consequently it does not prevent multiple base prices (catalogId NULL).
-- No table references Price rows, while OrderItem stores its own unit-price and
-- discount snapshots. It is therefore safe to retain only the deterministic
-- newest base row without changing any existing order snapshot.
-- Block concurrent price writes until the unique index is in place; reads remain
-- available. This also makes cleanup plus constraint creation atomic.
LOCK TABLE "Price" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked_base_prices AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "variantId"
      ORDER BY "createdAt" DESC, "updatedAt" DESC, "id" DESC
    ) AS retention_rank
  FROM "Price"
  WHERE "catalogId" IS NULL
)
DELETE FROM "Price" price
USING ranked_base_prices ranked
WHERE price."id" = ranked."id"
  AND ranked.retention_rank > 1;

-- A catalog-specific row overrides this base row. If no override exists for the
-- applicable active catalog, consumers must select the catalogId-NULL row.
CREATE UNIQUE INDEX "Price_one_base_per_variant_key"
  ON "Price"("variantId")
  WHERE "catalogId" IS NULL;

CREATE INDEX "Price_catalogId_variantId_idx"
  ON "Price"("catalogId", "variantId");

COMMIT;
