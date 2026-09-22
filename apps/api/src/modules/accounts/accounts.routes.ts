import { Router } from 'express';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireVerifiedActiveUser } from '../auth/auth.middleware.js';
import { ensureCustomerAccount, mapAccountMovement, mapCustomerAccount } from './account-ledger.js';

export const accountsRouter = Router();

accountsRouter.use(requireAuth, requireVerifiedActiveUser);

accountsRouter.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true } });
    if (!user || user.role !== 'CUSTOMER') {
      throw new AppError(403, 'Customer account is only available for customers', 'CUSTOMER_ACCOUNT_ONLY');
    }

    const account = await prisma.$transaction((tx) => ensureCustomerAccount(tx, req.user!.id));
    const movements = await prisma.customerAccountMovement.findMany({
      where: { customerAccountId: account.id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 80,
      include: { payment: { select: { method: true } }, order: { select: { orderNumber: true } } },
    });

    res.json({ account: mapCustomerAccount(account), movements: movements.map(mapAccountMovement) });
  } catch (error) {
    next(error);
  }
});
