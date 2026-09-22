CREATE SEQUENCE "Order_orderNumber_seq";

ALTER TABLE "Order" ADD COLUMN "orderNumber" INTEGER;

WITH numbered_orders AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS "number"
  FROM "Order"
)
UPDATE "Order" AS orders
SET "orderNumber" = numbered_orders."number"
FROM numbered_orders
WHERE orders."id" = numbered_orders."id";

SELECT setval(
  '"Order_orderNumber_seq"',
  COALESCE(MAX("orderNumber"), 1),
  MAX("orderNumber") IS NOT NULL
)
FROM "Order";

ALTER TABLE "Order"
  ALTER COLUMN "orderNumber" SET DEFAULT nextval('"Order_orderNumber_seq"'),
  ALTER COLUMN "orderNumber" SET NOT NULL;

ALTER SEQUENCE "Order_orderNumber_seq" OWNED BY "Order"."orderNumber";

ALTER TABLE "Order" ADD CONSTRAINT "Order_orderNumber_key" UNIQUE ("orderNumber");
