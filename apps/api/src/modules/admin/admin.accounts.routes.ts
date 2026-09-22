import { CustomerAccountMovementType, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { applyCustomerCredit, calculatePaymentStatus, createLedgerMovement, ensureCustomerAccount, isUniqueConstraintError, mapAccountMovement, mapCustomerAccount, runAccountingTransaction } from '../accounts/account-ledger.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminAccountsRouter = Router();

adminAccountsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const adjustmentSchema = z.object({
  direction: z.enum(['DEBIT', 'CREDIT']),
  amount: z.number().positive(),
  description: z.string().min(3).max(600),
  idempotencyKey: z.string().trim().min(8).max(120),
});

const creditApplicationSchema = z.object({
  destinationOrderId: z.string().uuid(),
  amount: z.number().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
  description: z.string().trim().max(600).optional(),
});

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapAccountListItem(account: Prisma.CustomerAccountGetPayload<{ include: { customer: true; _count: { select: { movements: true } } } }>) {
  return {
    ...mapCustomerAccount(account),
    customer: {
      id: account.customer.id,
      email: account.customer.email,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      phone: account.customer.phone,
      isActive: account.customer.isActive,
    },
    movementCount: account._count.movements,
  };
}

adminAccountsRouter.get('/customer-accounts', async (_req, res, next) => {
  try {
    const customerIds = await prisma.user.findMany({ where: { role: 'CUSTOMER' }, select: { id: true } });
    await prisma.$transaction((tx) => Promise.all(customerIds.map((customer) => ensureCustomerAccount(tx, customer.id))));

    const accounts = await prisma.customerAccount.findMany({
      where: { customer: { role: 'CUSTOMER' } },
      include: { customer: true, _count: { select: { movements: true } } },
      orderBy: [{ currentBalance: 'desc' }, { updatedAt: 'desc' }],
    });

    res.json({ accounts: accounts.map(mapAccountListItem) });
  } catch (error) {
    next(error);
  }
});

adminAccountsRouter.get('/customer-accounts/:customerId', async (req, res, next) => {
  try {
    const customerId = z.string().uuid().parse(req.params.customerId);
    const customer = await prisma.user.findUnique({ where: { id: customerId } });

    if (!customer || customer.role !== 'CUSTOMER') {
      throw new AppError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
    }

    const account = await prisma.$transaction((tx) => ensureCustomerAccount(tx, customerId));
    const movements = await prisma.customerAccountMovement.findMany({
      where: { customerAccountId: account.id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 150,
      include: { order: { select: { orderNumber: true } } },
    });

    res.json({
      account: {
        ...mapCustomerAccount(account),
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          isActive: customer.isActive,
        },
      },
      movements: movements.map(mapAccountMovement),
    });
  } catch (error) {
    next(error);
  }
});

adminAccountsRouter.post('/customer-accounts/:customerId/adjustments', async (req, res, next) => {
  let customerId = '';
  let data = {} as z.infer<typeof adjustmentSchema>;
  try {
    customerId = z.string().uuid().parse(req.params.customerId);
    data = adjustmentSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: customerId } });

    if (!customer || customer.role !== 'CUSTOMER') {
      throw new AppError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
    }

    const result = await runAccountingTransaction(async (tx) => {
      const existingMovement = await tx.customerAccountMovement.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existingMovement) {
        const metadata = existingMovement.metadata as { customerId?: string; direction?: string; amount?: number; description?: string } | null;
        if (metadata?.customerId !== customerId || metadata.direction !== data.direction || metadata.amount !== data.amount || metadata.description !== data.description) {
          throw new AppError(409, 'Idempotency key was already used with a different adjustment', 'IDEMPOTENCY_KEY_CONFLICT');
        }
        const account = await tx.customerAccount.findUniqueOrThrow({ where: { customerId } });
        return { account, movement: existingMovement, reused: true };
      }
      const before = await ensureCustomerAccount(tx, customerId);
      const movement = await createLedgerMovement(tx, {
        customerId,
        actorId: req.user!.id,
        type: data.direction === 'DEBIT' ? CustomerAccountMovementType.MANUAL_DEBIT_ADJUSTMENT : CustomerAccountMovementType.MANUAL_CREDIT_ADJUSTMENT,
         direction: data.direction,
         amount: data.amount,
         debtDelta: data.direction === 'DEBIT' ? data.amount : 0,
         creditDelta: data.direction === 'CREDIT' ? data.amount : 0,
        description: data.description,
         idempotencyKey: data.idempotencyKey,
         metadata: auditJson({ source: 'admin_adjustment', customerId, direction: data.direction, amount: data.amount, description: data.description }),
      });
      const after = await tx.customerAccount.findUniqueOrThrow({ where: { customerId } });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'CustomerAccount',
          entityId: after.id,
          action: data.direction === 'CREDIT' ? 'MANUAL_CREDIT_ADJUSTMENT' : 'MANUAL_DEBIT_ADJUSTMENT',
          before: auditJson(before),
          after: auditJson({ account: after, movement }),
        },
      });

       return { account: after, movement, reused: false };
    });

    res.status(201).json({ account: mapCustomerAccount(result.account), movement: mapAccountMovement(result.movement) });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existingMovement = await prisma.customerAccountMovement.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      const metadata = existingMovement?.metadata as { customerId?: string; direction?: string; amount?: number; description?: string } | null;
      if (existingMovement && metadata?.customerId === customerId && metadata.direction === data.direction && metadata.amount === data.amount && metadata.description === data.description) {
        const account = await prisma.customerAccount.findUnique({ where: { customerId } });
        if (account) {
          res.status(201).json({ account: mapCustomerAccount(account), movement: mapAccountMovement(existingMovement) });
          return;
        }
      }
      next(new AppError(409, 'Idempotency key was already used with a different adjustment', 'IDEMPOTENCY_KEY_CONFLICT'));
      return;
    }
    next(error);
  }
});

adminAccountsRouter.post('/customer-accounts/:customerId/credit-applications', async (req, res, next) => {
  let customerId = '';
  let data = {} as z.infer<typeof creditApplicationSchema>;
  try {
    customerId = z.string().uuid().parse(req.params.customerId);
    data = creditApplicationSchema.parse(req.body);
    const result = await runAccountingTransaction(async (tx) => {
      const result = await applyCustomerCredit(tx, {
        customerId,
        destinationOrderId: data.destinationOrderId,
        appliedById: req.user!.id,
        amount: data.amount,
        idempotencyKey: data.idempotencyKey,
        description: data.description,
      });
      const application = result.application;
      const order = await tx.order.findUniqueOrThrow({ where: { id: data.destinationOrderId }, select: { total: true } });
      const payments = await tx.payment.aggregate({ where: { orderId: data.destinationOrderId, status: { not: 'REFUNDED' } }, _sum: { appliedAmount: true }, _count: true });
      const applications = await tx.creditApplication.aggregate({ where: { destinationOrderId: data.destinationOrderId, reversedAt: null }, _sum: { remainingAmount: true }, _count: true });
      const paymentStatus = calculatePaymentStatus(
        order.total,
        payments._sum.appliedAmount ?? new Prisma.Decimal(0),
        applications._sum.remainingAmount ?? new Prisma.Decimal(0),
        payments._count > 0 || applications._count > 0,
      );
      await tx.order.update({ where: { id: data.destinationOrderId }, data: { paymentStatus } });
      if (!result.reused) await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'CreditApplication',
          entityId: application.id,
          action: 'CREATE',
          before: Prisma.JsonNull,
          after: auditJson({ application, destinationOrderId: data.destinationOrderId }),
        },
      });
      return { application, paymentStatus };
    });

    res.status(201).json({
      creditApplication: {
        id: result.application.id,
        customerId: result.application.customerId,
        destinationOrderId: result.application.destinationOrderId,
        movementId: result.application.movementId,
        amount: result.application.amount.toNumber(),
        remainingAmount: result.application.remainingAmount.toNumber(),
        appliedById: result.application.appliedById,
        description: result.application.description,
        appliedAt: result.application.appliedAt,
      },
      paymentStatus: result.paymentStatus,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.creditApplication.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existing && existing.customerId === customerId && existing.destinationOrderId === data.destinationOrderId && existing.amount.equals(data.amount) && existing.description === (data.description ?? null)) {
        const order = await prisma.order.findUnique({ where: { id: data.destinationOrderId }, select: { paymentStatus: true } });
        res.status(201).json({ creditApplication: { id: existing.id, customerId: existing.customerId, destinationOrderId: existing.destinationOrderId, movementId: existing.movementId, amount: existing.amount.toNumber(), remainingAmount: existing.remainingAmount.toNumber(), appliedById: existing.appliedById, description: existing.description, appliedAt: existing.appliedAt }, paymentStatus: order?.paymentStatus });
        return;
      }
      next(new AppError(409, 'Idempotency key was already used with a different credit application', 'IDEMPOTENCY_KEY_CONFLICT'));
      return;
    }
    next(error);
  }
});
