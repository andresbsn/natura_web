-- Add explicit reversal metadata while preserving the original payment row.
ALTER TABLE "Payment"
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedById" TEXT,
  ADD COLUMN "reversalReason" TEXT;

CREATE INDEX "Payment_reversedById_idx" ON "Payment"("reversedById");

-- Preserve compatibility for any legacy rows already marked as refunded.
UPDATE "Payment"
SET "reversedAt" = COALESCE("paidAt", "createdAt"),
    "reversedById" = "registeredById",
    "reversalReason" = 'Reverso heredado registrado antes del flujo formal'
WHERE "status" = 'REFUNDED';

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_reversalReason_required_when_reversed_check"
  CHECK (("status" <> 'REFUNDED') OR ("reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND length(trim("reversalReason")) >= 3));
