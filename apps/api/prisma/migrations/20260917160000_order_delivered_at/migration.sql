ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);

UPDATE "Order"
SET "deliveredAt" = "updatedAt"
WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NULL;

CREATE INDEX "Order_status_deliveredAt_idx" ON "Order"("status", "deliveredAt");
