-- This backfill is deterministic for the database state produced by the previous
-- account/credit migrations. The VPS must be cleaned/reset before real data is
-- loaded; this migration is not a safe inference/reconciliation of an account
-- whose materialized balances were changed outside the ledger.

-- Cancelled orders are terminal: preserve payment identity and existing allocations,
-- but expose all non-refunded payment value as reusable credit. The account-credit
-- separation migration already included these payment credits in availableCredit,
-- so this step deliberately does not add them a second time.
UPDATE "Payment" AS payment
SET
  "creditAmount" = "creditAmount" + "appliedAmount",
  "appliedAmount" = 0
FROM "Order" AS order_record
WHERE payment."orderId" = order_record."id"
  AND order_record."status" = 'CANCELLED'
  AND payment."status" <> 'REFUNDED'
  AND payment."reversedAt" IS NULL
   AND payment."appliedAmount" > 0;

-- Capture active applications before changing them. Only remaining (not the
-- original application amount) is returned: consumed credit has already affected
-- the destination order and must not be returned twice.
CREATE TEMP TABLE "_cancelled_credit_applications" ON COMMIT DROP AS
SELECT
  application."id",
  application."customerAccountId",
  application."customerId",
  application."destinationOrderId",
  application."appliedById",
  application."remainingAmount"
FROM "CreditApplication" AS application
JOIN "Order" AS destination_order ON destination_order."id" = application."destinationOrderId"
WHERE destination_order."status" = 'CANCELLED'
  AND application."reversedAt" IS NULL;

UPDATE "PaymentCreditAllocation" AS allocation
SET
  "reversedAt" = CURRENT_TIMESTAMP,
  "reversedById" = application."appliedById",
  "reversalReason" = 'Pedido destino cancelado'
FROM "CreditApplication" AS application
JOIN "Order" AS destination_order ON destination_order."id" = application."destinationOrderId"
WHERE allocation."creditApplicationId" = application."id"
  AND destination_order."status" = 'CANCELLED'
  AND allocation."reversedAt" IS NULL;

UPDATE "CreditApplication" AS application
SET
  "remainingAmount" = 0,
  "reversedAt" = CURRENT_TIMESTAMP,
  "reversedById" = candidate."appliedById",
  "reversalReason" = 'Pedido destino cancelado'
FROM "_cancelled_credit_applications" AS candidate
WHERE application."id" = candidate."id";

-- One idempotent ledger movement per application restores only its remaining
-- credit. availableCredit is updated from the same captured rows, so rerunning
-- the SQL cannot create a second return (the candidate rows are no longer active).
INSERT INTO "CustomerAccountMovement" (
  "id", "customerAccountId", "customerId", "orderId", "actorId", "type",
  "direction", "amount", "balanceAfter", "description", "idempotencyKey",
  "metadata", "occurredAt", "createdAt"
)
SELECT
  'customer_account_movement_' || md5('credit-application:' || candidate."id" || ':cancel-reversal'),
  candidate."customerAccountId",
  candidate."customerId",
  candidate."destinationOrderId",
  candidate."appliedById",
  'CREDIT_APPLICATION_REVERSAL'::"CustomerAccountMovementType",
  'CREDIT'::"CustomerAccountMovementDirection",
  candidate."remainingAmount",
  account."currentBalance",
  'Reversion de credito aplicado por cancelacion del pedido',
  'credit-application:' || candidate."id" || ':cancel-reversal',
  jsonb_build_object('source', 'migration_20260922130000', 'applicationId', candidate."id"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_cancelled_credit_applications" AS candidate
JOIN "CustomerAccount" AS account ON account."id" = candidate."customerAccountId"
WHERE candidate."remainingAmount" > 0
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "CustomerAccount" AS account
SET
  "availableCredit" = account."availableCredit" + returned."amount",
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "customerAccountId", SUM("remainingAmount") AS "amount"
  FROM "_cancelled_credit_applications"
  WHERE "remainingAmount" > 0
  GROUP BY "customerAccountId"
) AS returned
WHERE account."id" = returned."customerAccountId";

-- Cancelled orders cannot retain active coverage. Keep REFUNDED when there is
-- payment/application history, otherwise leave a never-paid order UNPAID.
UPDATE "Order" AS order_record
SET "paymentStatus" = CASE
  WHEN EXISTS (SELECT 1 FROM "Payment" payment WHERE payment."orderId" = order_record."id")
    OR EXISTS (SELECT 1 FROM "CreditApplication" application WHERE application."destinationOrderId" = order_record."id")
    THEN 'REFUNDED'::"PaymentStatus"
  ELSE 'UNPAID'::"PaymentStatus"
END
WHERE order_record."status" = 'CANCELLED';
