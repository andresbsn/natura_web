-- Separate debt from reusable credit. Existing ledger rows remain untouched.
ALTER TABLE "CustomerAccount"
  ADD COLUMN "availableCredit" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
  ADD COLUMN "appliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "CreditApplication"
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedById" TEXT,
  ADD COLUMN "reversalReason" TEXT,
  ADD COLUMN "remainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "CreditApplication" SET "remainingAmount" = "amount";

-- Reconstruct the portion of each historical payment applied to its order.
WITH ordered AS (
  SELECT p."id", p."orderId", p."amount", p."status", o."total",
    COALESCE(SUM(CASE WHEN p."status" <> 'REFUNDED' THEN p."amount" ELSE 0 END) OVER (
      PARTITION BY p."orderId"
      ORDER BY p."createdAt", p."id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS "priorPaid"
  FROM "Payment" p
  JOIN "Order" o ON o."id" = p."orderId"
), reconstructed AS (
  SELECT "id",
    CASE WHEN "status" = 'REFUNDED' THEN 0
      ELSE LEAST("amount", GREATEST("total" - "priorPaid", 0)) END AS "appliedAmount",
    CASE WHEN "status" = 'REFUNDED' THEN 0
      ELSE "amount" - LEAST("amount", GREATEST("total" - "priorPaid", 0)) END AS "creditAmount"
  FROM ordered
)
UPDATE "Payment" p
SET "appliedAmount" = r."appliedAmount", "creditAmount" = r."creditAmount"
FROM reconstructed r WHERE p."id" = r."id";

-- Preserve the historical net result while making future debt non-negative.
UPDATE "CustomerAccount"
SET "availableCredit" = GREATEST(-"currentBalance", 0),
    "currentBalance" = GREATEST("currentBalance", 0),
    "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "CustomerAccount"
  ADD CONSTRAINT "CustomerAccount_availableCredit_non_negative_check" CHECK ("availableCredit" >= 0);
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_appliedAmount_non_negative_check" CHECK ("appliedAmount" >= 0),
  ADD CONSTRAINT "Payment_creditAmount_non_negative_check" CHECK ("creditAmount" >= 0),
  ADD CONSTRAINT "Payment_amount_parts_check" CHECK ("appliedAmount" + "creditAmount" = "amount" OR "status" = 'REFUNDED');

CREATE TABLE "PaymentCreditAllocation" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "creditApplicationId" TEXT NOT NULL,
  "allocatedById" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedById" TEXT,
  "reversalReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCreditAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentCreditAllocation_idempotencyKey_key" ON "PaymentCreditAllocation"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentCreditAllocation_paymentId_creditApplicationId_key" ON "PaymentCreditAllocation"("paymentId", "creditApplicationId");
CREATE INDEX "PaymentCreditAllocation_paymentId_idx" ON "PaymentCreditAllocation"("paymentId");
CREATE INDEX "PaymentCreditAllocation_creditApplicationId_idx" ON "PaymentCreditAllocation"("creditApplicationId");
ALTER TABLE "PaymentCreditAllocation" ADD CONSTRAINT "PaymentCreditAllocation_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentCreditAllocation" ADD CONSTRAINT "PaymentCreditAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCreditAllocation" ADD CONSTRAINT "PaymentCreditAllocation_creditApplicationId_fkey" FOREIGN KEY ("creditApplicationId") REFERENCES "CreditApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCreditAllocation" ADD CONSTRAINT "PaymentCreditAllocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PaymentCreditAllocation_reversedById_idx" ON "PaymentCreditAllocation"("reversedById");
ALTER TABLE "PaymentCreditAllocation" ADD CONSTRAINT "PaymentCreditAllocation_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CreditApplication_reversedById_idx" ON "CreditApplication"("reversedById");
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_remainingAmount_range_check" CHECK ("remainingAmount" >= 0 AND "remainingAmount" <= "amount");
