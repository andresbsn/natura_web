import { CustomerAccountMovementDirection, CustomerAccountMovementType, Prisma } from '@prisma/client';

import { AppError } from '../../http/errors.js';

export type AccountTx = Prisma.TransactionClient;

type LedgerMovementInput = {
  customerId: string;
  orderId?: string | null;
  paymentId?: string | null;
  actorId?: string | null;
  type: CustomerAccountMovementType;
  direction: CustomerAccountMovementDirection;
  amount: Prisma.Decimal | number;
  description?: string;
  idempotencyKey: string;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
};

export function decimalToNumber(value: { toNumber(): number }) {
  return value.toNumber();
}

export function accountDelta(direction: CustomerAccountMovementDirection, amount: Prisma.Decimal) {
  return direction === 'DEBIT' ? amount : amount.mul(-1);
}

export async function ensureCustomerAccount(tx: AccountTx, customerId: string) {
  const customer = await tx.user.findUnique({ where: { id: customerId }, select: { role: true } });

  if (!customer || customer.role !== 'CUSTOMER') {
    throw new AppError(403, 'Customer account is only available for customers', 'CUSTOMER_ACCOUNT_ONLY');
  }

  return tx.customerAccount.upsert({
    where: { customerId },
    create: { customerId, currency: 'ARS' },
    update: {},
  });
}

export async function createLedgerMovement(tx: AccountTx, input: LedgerMovementInput) {
  const amount = new Prisma.Decimal(input.amount);

  if (!amount.greaterThan(0)) {
    throw new Error('Ledger movement amount must be positive');
  }

  const existingMovement = await tx.customerAccountMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existingMovement) return existingMovement;

  const account = await ensureCustomerAccount(tx, input.customerId);
  await tx.$queryRaw`SELECT id FROM "CustomerAccount" WHERE id = ${account.id} FOR UPDATE`;

  const lockedAccount = await tx.customerAccount.findUniqueOrThrow({ where: { id: account.id } });
  const nextBalance = lockedAccount.currentBalance.add(accountDelta(input.direction, amount));
  const occurredAt = input.occurredAt ?? new Date();

  const movement = await tx.customerAccountMovement.create({
    data: {
      customerAccountId: lockedAccount.id,
      customerId: input.customerId,
      orderId: input.orderId ?? null,
      paymentId: input.paymentId ?? null,
      actorId: input.actorId ?? null,
      type: input.type,
      direction: input.direction,
      amount,
      balanceAfter: nextBalance,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      occurredAt,
    },
  });

  await tx.customerAccount.update({
    where: { id: lockedAccount.id },
    data: {
      currentBalance: nextBalance,
      lastMovementAt: occurredAt,
    },
  });

  return movement;
}

export function mapAccountMovement(movement: {
  id: string;
  orderId: string | null;
  paymentId: string | null;
  actorId: string | null;
  type: CustomerAccountMovementType;
  direction: CustomerAccountMovementDirection;
  amount: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  description: string | null;
  documentNumber: string | null;
  documentUrl: string | null;
  metadata: Prisma.JsonValue | null;
  occurredAt: Date;
  createdAt: Date;
}) {
  return {
    id: movement.id,
    orderId: movement.orderId,
    paymentId: movement.paymentId,
    actorId: movement.actorId,
    type: movement.type,
    direction: movement.direction,
    amount: decimalToNumber(movement.amount),
    balanceAfter: decimalToNumber(movement.balanceAfter),
    description: movement.description,
    documentNumber: movement.documentNumber,
    documentUrl: movement.documentUrl,
    metadata: movement.metadata,
    occurredAt: movement.occurredAt,
    createdAt: movement.createdAt,
  };
}

export function mapCustomerAccount(account: {
  id: string;
  customerId: string;
  currentBalance: Prisma.Decimal;
  currency: string;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    customerId: account.customerId,
    currentBalance: decimalToNumber(account.currentBalance),
    currency: account.currency,
    lastMovementAt: account.lastMovementAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
