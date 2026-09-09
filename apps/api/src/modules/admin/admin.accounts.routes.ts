import { CustomerAccountMovementType, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { createLedgerMovement, ensureCustomerAccount, mapAccountMovement, mapCustomerAccount } from '../accounts/account-ledger.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminAccountsRouter = Router();

adminAccountsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const adjustmentSchema = z.object({
  direction: z.enum(['DEBIT', 'CREDIT']),
  amount: z.number().positive(),
  description: z.string().min(3).max(600),
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
  try {
    const customerId = z.string().uuid().parse(req.params.customerId);
    const data = adjustmentSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: customerId } });

    if (!customer || customer.role !== 'CUSTOMER') {
      throw new AppError(404, 'Customer not found', 'CUSTOMER_NOT_FOUND');
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await ensureCustomerAccount(tx, customerId);
      const movement = await createLedgerMovement(tx, {
        customerId,
        actorId: req.user!.id,
        type: data.direction === 'DEBIT' ? CustomerAccountMovementType.MANUAL_DEBIT_ADJUSTMENT : CustomerAccountMovementType.MANUAL_CREDIT_ADJUSTMENT,
        direction: data.direction,
        amount: data.amount,
        description: data.description,
        idempotencyKey: `manual-adjustment:${customerId}:${req.user!.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        metadata: auditJson({ source: 'admin_adjustment' }),
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

      return { account: after, movement };
    });

    res.status(201).json({ account: mapCustomerAccount(result.account), movement: mapAccountMovement(result.movement) });
  } catch (error) {
    next(error);
  }
});
