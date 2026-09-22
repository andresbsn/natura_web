-- Explicit, manually controlled use of customer account credit.
ALTER TYPE "CustomerAccountMovementType" ADD VALUE 'CREDIT_APPLICATION';
ALTER TYPE "CustomerAccountMovementType" ADD VALUE 'CREDIT_APPLICATION_REVERSAL';

CREATE TABLE "CreditApplication" (
  "id" TEXT NOT NULL,
  "customerAccountId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "destinationOrderId" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "appliedById" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "description" TEXT,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditApplication_movementId_key" ON "CreditApplication"("movementId");
CREATE UNIQUE INDEX "CreditApplication_idempotencyKey_key" ON "CreditApplication"("idempotencyKey");
CREATE INDEX "CreditApplication_customerId_appliedAt_idx" ON "CreditApplication"("customerId", "appliedAt");
CREATE INDEX "CreditApplication_customerAccountId_appliedAt_idx" ON "CreditApplication"("customerAccountId", "appliedAt");
CREATE INDEX "CreditApplication_destinationOrderId_idx" ON "CreditApplication"("destinationOrderId");
CREATE INDEX "CreditApplication_appliedById_idx" ON "CreditApplication"("appliedById");

ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_destinationOrderId_fkey" FOREIGN KEY ("destinationOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "CustomerAccountMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
