import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const userUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapAdminUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

adminUsersRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users: users.map(mapAdminUser) });
  } catch (error) {
    next(error);
  }
});

adminUsersRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = userUpdateSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { id } });

    if (!existing || existing.role !== 'CUSTOMER') {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          isActive: data.isActive,
          passwordHash: data.password ? await bcrypt.hash(data.password, 12) : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'User',
          entityId: id,
          action: data.password ? 'UPDATE_PASSWORD' : 'UPDATE',
          before: auditJson(mapAdminUser(existing)),
          after: auditJson(mapAdminUser(updated)),
        },
      });

      return updated;
    });

    res.json({ user: mapAdminUser(user) });
  } catch (error) {
    next(error);
  }
});
