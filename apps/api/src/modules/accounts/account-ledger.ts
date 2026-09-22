import { CustomerAccountMovementDirection, CustomerAccountMovementType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AppError } from '../../http/errors.js';
import { prisma } from '../../db/prisma.js';

export type AccountTx = Prisma.TransactionClient;

export function isRetryableAccountingError(error: unknown) {
  const candidate = error as { code?: string; message?: string; meta?: { code?: string } };
  return candidate.code === 'P2034' || candidate.meta?.code === '40P01' || candidate.message?.includes('40P01') || candidate.message?.toLowerCase().includes('deadlock detected');
}

export function isUniqueConstraintError(error: unknown) {
  return (error as { code?: string }).code === 'P2002';
}

export async function runAccountingTransaction<T>(operation: (tx: AccountTx) => Promise<T>, maxRetries = 2) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { timeout: 15_000, maxWait: 5_000 });
    } catch (error) {
      if (!isRetryableAccountingError(error) || attempt >= maxRetries) throw error;
    }
  }
}

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
  id?: string;
  debtDelta?: Prisma.Decimal | number;
  creditDelta?: Prisma.Decimal | number;
};

export function decimalToNumber(value: { toNumber(): number }) {
  return value.toNumber();
}

export function accountDelta(direction: CustomerAccountMovementDirection, amount: Prisma.Decimal) {
  return direction === 'DEBIT' ? amount : amount.mul(-1);
}

export function calculatePaymentStatus(
  total: Prisma.Decimal,
  validPaymentsApplied: Prisma.Decimal,
  appliedCredit: Prisma.Decimal,
  hasHistoricalPaymentOrApplication: boolean,
) {
  const covered = validPaymentsApplied.add(appliedCredit);
  if (covered.equals(0)) return hasHistoricalPaymentOrApplication ? 'REFUNDED' as const : 'UNPAID' as const;
  return covered.greaterThanOrEqualTo(total) ? 'PAID' as const : 'PARTIALLY_PAID' as const;
}

export function calculateCancelledPaymentStatus(total: Prisma.Decimal, hasHistoricalPaymentOrApplication: boolean) {
  return calculatePaymentStatus(total, new Prisma.Decimal(0), new Prisma.Decimal(0), hasHistoricalPaymentOrApplication);
}

export function splitPayment(amount: Prisma.Decimal, outstandingDebt: Prisma.Decimal) {
  const appliedAmount = Prisma.Decimal.min(amount, outstandingDebt.greaterThan(0) ? outstandingDebt : new Prisma.Decimal(0));
  return { appliedAmount, creditAmount: amount.sub(appliedAmount) };
}

export function reclassifyPaymentsForReducedTotal(
  payments: Array<{ id: string; amount: Prisma.Decimal; status: string; createdAt: Date }>,
  nextTotal: Prisma.Decimal,
  appliedCredit: Prisma.Decimal,
) {
  let remainingCoverage = Prisma.Decimal.max(nextTotal.sub(appliedCredit), new Prisma.Decimal(0));
  return [...payments]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    .map((payment) => {
      if (payment.status === 'REFUNDED') return { id: payment.id, appliedAmount: new Prisma.Decimal(0), creditAmount: new Prisma.Decimal(0) };
      const appliedAmount = Prisma.Decimal.min(payment.amount, remainingCoverage);
      remainingCoverage = remainingCoverage.sub(appliedAmount);
      return { id: payment.id, appliedAmount, creditAmount: payment.amount.sub(appliedAmount) };
    });
}

export function reclassifyPaymentsForCancellation(
  payments: Array<{ id: string; appliedAmount: Prisma.Decimal; creditAmount: Prisma.Decimal; status: string; reversedAt?: Date | null }>,
) {
  return payments
    .filter((payment) => payment.status !== 'REFUNDED' && !payment.reversedAt)
    .map((payment) => ({
      id: payment.id,
      appliedAmount: new Prisma.Decimal(0),
      creditAmount: payment.creditAmount.add(payment.appliedAmount),
    }));
}

export function calculateCancellationEffect(total: Prisma.Decimal, appliedPayments: Prisma.Decimal, appliedCredits: Prisma.Decimal) {
  const debtToRelease = Prisma.Decimal.max(total.sub(appliedPayments).sub(appliedCredits), new Prisma.Decimal(0));
  return { debtToRelease, creditToRestore: appliedPayments.add(appliedCredits) };
}

export function calculatePaymentReversalEffect(
  appliedAmount: Prisma.Decimal,
  creditAmount: Prisma.Decimal,
  allocatedCredit: Prisma.Decimal,
  orderWasCancelled: boolean,
) {
  const creditToRemove = (orderWasCancelled ? appliedAmount.add(creditAmount) : creditAmount).sub(allocatedCredit);
  return { debtToRestore: orderWasCancelled ? new Prisma.Decimal(0) : appliedAmount, creditToRemove };
}

export function isCreditApplicationAllowed(amount: Prisma.Decimal, availableCredit: Prisma.Decimal, orderDebt: Prisma.Decimal) {
  return amount.greaterThan(0) && availableCredit.greaterThanOrEqualTo(amount) && orderDebt.greaterThanOrEqualTo(amount);
}

export function creditApplicationMovementKey(idempotencyKey: string) {
  return `credit-application:${idempotencyKey}`;
}

export function totalAdjustmentMovementKey(orderId: string, requestKey: string) {
  return `order:${orderId}:total-adjustment:${requestKey}`;
}

export function canReduceOrderTotal(nextTotal: Prisma.Decimal, activeAppliedCredit: Prisma.Decimal) {
  return nextTotal.greaterThanOrEqualTo(activeAppliedCredit);
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
  const debtDelta = input.debtDelta === undefined ? accountDelta(input.direction, amount) : new Prisma.Decimal(input.debtDelta);
  const creditDelta = input.creditDelta === undefined ? new Prisma.Decimal(0) : new Prisma.Decimal(input.creditDelta);
  const nextBalance = lockedAccount.currentBalance.add(debtDelta);
  const nextAvailableCredit = lockedAccount.availableCredit.add(creditDelta);
  if (nextBalance.lessThan(0) || nextAvailableCredit.lessThan(0)) {
    throw new AppError(409, 'Account balance cannot become negative', 'ACCOUNT_BALANCE_INVALID');
  }
  const occurredAt = input.occurredAt ?? new Date();

  const movement = await tx.customerAccountMovement.create({
    data: {
      id: input.id ?? randomUUID(),
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
      availableCredit: nextAvailableCredit,
      lastMovementAt: occurredAt,
    },
  });

  return movement;
}

export async function applyCustomerCredit(
  tx: AccountTx,
  input: {
    customerId: string;
    destinationOrderId: string;
    appliedById: string;
    amount: Prisma.Decimal | number;
    idempotencyKey: string;
    description?: string;
  },
) {
  const existing = await tx.creditApplication.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.customerId !== input.customerId || existing.destinationOrderId !== input.destinationOrderId || !existing.amount.equals(input.amount) || existing.description !== (input.description ?? null)) {
      throw new AppError(409, 'Idempotency key was already used with a different credit application', 'IDEMPOTENCY_KEY_CONFLICT');
    }
    return { application: existing, reused: true };
  }

  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.destinationOrderId} FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: input.destinationOrderId }, select: { id: true, customerId: true, status: true, total: true } });
  if (!order) throw new AppError(404, 'Destination order not found', 'ORDER_NOT_FOUND');
  if (order.customerId !== input.customerId) throw new AppError(403, 'Order does not belong to customer', 'ORDER_CUSTOMER_MISMATCH');
  if (order.status === 'PENDING' || order.status === 'CANCELLED') {
    throw new AppError(409, 'Credit can only be applied to an approved order', 'ORDER_NOT_APPROVED');
  }

  const payments = await tx.payment.aggregate({ where: { orderId: order.id, status: { not: 'REFUNDED' } }, _sum: { appliedAmount: true } });
  const applications = await tx.creditApplication.aggregate({ where: { destinationOrderId: order.id, reversedAt: null }, _sum: { remainingAmount: true } });
  const outstandingDebt = order.total
    .sub(payments._sum.appliedAmount ?? new Prisma.Decimal(0))
    .sub(applications._sum.remainingAmount ?? new Prisma.Decimal(0));

  const account = await ensureCustomerAccount(tx, input.customerId);
  await tx.$queryRaw`SELECT id FROM "CustomerAccount" WHERE id = ${account.id} FOR UPDATE`;
  const lockedAccount = await tx.customerAccount.findUniqueOrThrow({ where: { id: account.id } });
  const amount = new Prisma.Decimal(input.amount);
  if (!amount.greaterThan(0)) throw new AppError(400, 'Credit application amount must be positive', 'INVALID_CREDIT_APPLICATION_AMOUNT');

  const availableCredit = lockedAccount.availableCredit;
  if (amount.greaterThan(availableCredit)) {
    throw new AppError(409, 'Credit application exceeds available credit', 'INSUFFICIENT_CREDIT');
  }
  if (!isCreditApplicationAllowed(amount, availableCredit, outstandingDebt)) {
    throw new AppError(409, 'Credit application exceeds order debt', 'APPLICATION_EXCEEDS_ORDER_DEBT');
  }

  const applicationId = randomUUID();
  const movement = await createLedgerMovement(tx, {
    id: randomUUID(),
    customerId: input.customerId,
    orderId: input.destinationOrderId,
    actorId: input.appliedById,
    type: CustomerAccountMovementType.CREDIT_APPLICATION,
    direction: CustomerAccountMovementDirection.DEBIT,
    amount,
    debtDelta: amount.mul(-1),
    creditDelta: amount.mul(-1),
    description: input.description ?? `Aplicacion de credito al pedido ${input.destinationOrderId.slice(0, 8)}`,
    idempotencyKey: creditApplicationMovementKey(input.idempotencyKey),
    metadata: { source: 'admin_credit_application', destinationOrderId: input.destinationOrderId },
  });

  const application = await tx.creditApplication.create({
    data: {
      id: applicationId,
      customerAccountId: lockedAccount.id,
      customerId: input.customerId,
      destinationOrderId: input.destinationOrderId,
      movementId: movement.id,
      appliedById: input.appliedById,
      amount,
      remainingAmount: amount,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
    },
  });

  let remaining = amount;
  const paymentCredits = await tx.payment.findMany({
    where: { order: { customerId: input.customerId }, status: { not: 'REFUNDED' }, creditAmount: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
    include: { creditAllocations: { where: { creditApplication: { reversedAt: null } } } },
  });
  for (const payment of paymentCredits) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const allocated = payment.creditAllocations.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    const availableFromPayment = payment.creditAmount.sub(allocated);
    if (availableFromPayment.lessThanOrEqualTo(0)) continue;
    const allocationAmount = Prisma.Decimal.min(remaining, availableFromPayment);
    await tx.paymentCreditAllocation.create({
      data: {
        paymentId: payment.id,
        creditApplicationId: application.id,
        allocatedById: input.appliedById,
        amount: allocationAmount,
        idempotencyKey: `credit-application:${input.idempotencyKey}:payment:${payment.id}`,
      },
    });
    remaining = remaining.sub(allocationAmount);
  }

  return { application, reused: false };
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
  payment?: { method: string | null } | null;
  order?: { orderNumber: number } | null;
  occurredAt: Date;
  createdAt: Date;
}) {
  return {
    id: movement.id,
    orderId: movement.orderId,
    orderNumber: movement.order?.orderNumber ?? null,
    paymentId: movement.paymentId,
    paymentMethod: movement.payment?.method ?? null,
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
  availableCredit: Prisma.Decimal;
  currency: string;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    customerId: account.customerId,
    currentBalance: decimalToNumber(account.currentBalance),
    debt: decimalToNumber(account.currentBalance),
    availableCredit: decimalToNumber(account.availableCredit),
    currency: account.currency,
    lastMovementAt: account.lastMovementAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
