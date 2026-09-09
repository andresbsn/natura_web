-- CreateEnum
CREATE TYPE "CustomerAccountMovementType" AS ENUM (
  'ORDER_CHARGE',
  'ORDER_CANCEL_CREDIT',
  'PAYMENT_CREDIT',
  'PAYMENT_REFUND_DEBIT',
  'MANUAL_DEBIT_ADJUSTMENT',
  'MANUAL_CREDIT_ADJUSTMENT'
);

-- CreateEnum
CREATE TYPE "CustomerAccountMovementDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "CustomerAccount" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "currentBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "lastMovementAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccountMovement" (
  "id" TEXT NOT NULL,
  "customerAccountId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "actorId" TEXT,
  "type" "CustomerAccountMovementType" NOT NULL,
  "direction" "CustomerAccountMovementDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "description" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "documentNumber" TEXT,
  "documentUrl" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerAccountMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");
CREATE INDEX "CustomerAccount_currentBalance_idx" ON "CustomerAccount"("currentBalance");
CREATE INDEX "CustomerAccount_lastMovementAt_idx" ON "CustomerAccount"("lastMovementAt");
CREATE UNIQUE INDEX "CustomerAccountMovement_idempotencyKey_key" ON "CustomerAccountMovement"("idempotencyKey");
CREATE INDEX "CustomerAccountMovement_customerAccountId_occurredAt_idx" ON "CustomerAccountMovement"("customerAccountId", "occurredAt");
CREATE INDEX "CustomerAccountMovement_customerId_occurredAt_idx" ON "CustomerAccountMovement"("customerId", "occurredAt");
CREATE INDEX "CustomerAccountMovement_orderId_idx" ON "CustomerAccountMovement"("orderId");
CREATE INDEX "CustomerAccountMovement_paymentId_idx" ON "CustomerAccountMovement"("paymentId");
CREATE INDEX "CustomerAccountMovement_actorId_idx" ON "CustomerAccountMovement"("actorId");
CREATE INDEX "CustomerAccountMovement_type_idx" ON "CustomerAccountMovement"("type");

-- Check constraints
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_amount_positive_check" CHECK ("amount" > 0);

ALTER TABLE "CustomerAccount"
  ADD CONSTRAINT "CustomerAccount_currency_not_blank_check" CHECK (length(trim("currency")) > 0);

-- ForeignKeys
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountMovement" ADD CONSTRAINT "CustomerAccountMovement_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountMovement" ADD CONSTRAINT "CustomerAccountMovement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountMovement" ADD CONSTRAINT "CustomerAccountMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountMovement" ADD CONSTRAINT "CustomerAccountMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountMovement" ADD CONSTRAINT "CustomerAccountMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill accounts for existing customers and users with orders.
INSERT INTO "CustomerAccount" ("id", "customerId", "currentBalance", "currency", "createdAt", "updatedAt")
SELECT 'customer_account_' || u."id", u."id", 0, 'ARS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'CUSTOMER'
ON CONFLICT ("customerId") DO NOTHING;

-- Backfill ledger movements for existing non-cancelled orders and effective payments.
WITH ledger_events AS (
  SELECT
    ca."id" AS "customerAccountId",
    o."customerId",
    o."id" AS "orderId",
    NULL::TEXT AS "paymentId",
    NULL::TEXT AS "actorId",
    'ORDER_CHARGE'::"CustomerAccountMovementType" AS "type",
    'DEBIT'::"CustomerAccountMovementDirection" AS "direction",
    o."total" AS "amount",
    o."createdAt" AS "occurredAt",
    'order:' || o."id" || ':charge' AS "idempotencyKey",
    'Cargo por pedido existente' AS "description",
    jsonb_build_object('source', 'backfill', 'orderStatus', o."status", 'paymentStatus', o."paymentStatus") AS "metadata",
    1 AS "sortPriority"
  FROM "Order" o
  JOIN "CustomerAccount" ca ON ca."customerId" = o."customerId"
  WHERE o."status" <> 'CANCELLED' AND o."total" > 0

  UNION ALL

  SELECT
    ca."id" AS "customerAccountId",
    o."customerId",
    p."orderId",
    p."id" AS "paymentId",
    p."registeredById" AS "actorId",
    'PAYMENT_CREDIT'::"CustomerAccountMovementType" AS "type",
    'CREDIT'::"CustomerAccountMovementDirection" AS "direction",
    p."amount" AS "amount",
    COALESCE(p."paidAt", p."createdAt") AS "occurredAt",
    'payment:' || p."id" || ':credit' AS "idempotencyKey",
    'Pago existente registrado' AS "description",
    jsonb_build_object('source', 'backfill', 'paymentStatus', p."status", 'method', p."method") AS "metadata",
    2 AS "sortPriority"
  FROM "Payment" p
  JOIN "Order" o ON o."id" = p."orderId"
  JOIN "CustomerAccount" ca ON ca."customerId" = o."customerId"
  WHERE p."status" IN ('PAID', 'PARTIALLY_PAID') AND p."amount" > 0
),
ordered_events AS (
  SELECT
    *,
    SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END) OVER (
      PARTITION BY "customerAccountId"
      ORDER BY "occurredAt", "sortPriority", "idempotencyKey"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "balanceAfter"
  FROM ledger_events
)
INSERT INTO "CustomerAccountMovement" (
  "id", "customerAccountId", "customerId", "orderId", "paymentId", "actorId", "type", "direction", "amount", "balanceAfter", "description", "idempotencyKey", "metadata", "occurredAt", "createdAt"
)
SELECT
  'customer_account_movement_' || md5("idempotencyKey"),
  "customerAccountId", "customerId", "orderId", "paymentId", "actorId", "type", "direction", "amount", "balanceAfter", "description", "idempotencyKey", "metadata", "occurredAt", CURRENT_TIMESTAMP
FROM ordered_events
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Backfill materialized balances.
WITH balances AS (
  SELECT
    "customerAccountId",
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END), 0) AS "balance",
    MAX("occurredAt") AS "lastMovementAt"
  FROM "CustomerAccountMovement"
  GROUP BY "customerAccountId"
)
UPDATE "CustomerAccount" ca
SET "currentBalance" = b."balance", "lastMovementAt" = b."lastMovementAt", "updatedAt" = CURRENT_TIMESTAMP
FROM balances b
WHERE ca."id" = b."customerAccountId";
