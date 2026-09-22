-- Nullable for historical rows and the controlled compatibility window only.
-- Legacy writers that omit it remain identifiable as legacy data; the new API
-- rejects missing keys and never infers a full payment from a missing key.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
