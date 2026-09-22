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
const adminCreateSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(8), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().max(40).optional(), role: z.enum(['ADMIN', 'SUPER_ADMIN']).default('ADMIN') });
const adminUpdateSchema = z.object({ isActive: z.boolean().optional(), role: z.enum(['ADMIN', 'SUPER_ADMIN']).optional() }).refine((value) => Object.keys(value).length > 0);

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapAdminUser(user: {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
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
    emailVerified: Boolean(user.emailVerifiedAt),
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

adminUsersRouter.get('/users', async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().min(1).max(120).optional(), isActive: z.coerce.boolean().optional() }).parse(req.query);
    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    const where = { role: 'CUSTOMER' as const, ...(query.isActive === undefined ? {} : { isActive: query.isActive }), ...(query.search ? { OR: [{ email: { contains: query.search, mode: 'insensitive' as const } }, { firstName: { contains: query.search, mode: 'insensitive' as const } }, { lastName: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
    const [users, total] = await prisma.$transaction([prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(paginate ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}),
    }), prisma.user.count({ where })]);

    res.json({ users: users.map(mapAdminUser), pagination: { page: query.page, pageSize: paginate ? query.pageSize : total, total, totalPages: paginate ? Math.ceil(total / query.pageSize) : 1 } });
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

      if (data.password) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }

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

const superAdminOnly = [requireAuth, requireRole('SUPER_ADMIN')];
adminUsersRouter.get('/admins', ...superAdminOnly, async (_req, res, next) => {
  try { const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, orderBy: { createdAt: 'desc' } }); res.json({ admins: admins.map(mapAdminUser) }); } catch (error) { next(error); }
});

adminUsersRouter.post('/admins', ...superAdminOnly, async (req, res, next) => {
  try {
    const data = adminCreateSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const admin = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email: data.email, passwordHash, firstName: data.firstName, lastName: data.lastName, phone: data.phone, role: data.role, emailVerifiedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'User', entityId: created.id, action: 'ADMIN_CREATE', after: auditJson(mapAdminUser(created)) } });
      return created;
    });
    res.status(201).json({ admin: mapAdminUser(admin) });
  } catch (error) { next(error); }
});

adminUsersRouter.patch('/admins/:id', ...superAdminOnly, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id); const data = adminUpdateSchema.parse(req.body);
    if (id === req.user!.id && (data.isActive !== undefined || data.role !== undefined)) throw new AppError(409, 'Cannot change your own administrative privileges', 'SELF_ADMIN_CHANGE_FORBIDDEN');
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id } });
      if (!current || !['ADMIN', 'SUPER_ADMIN'].includes(current.role)) throw new AppError(404, 'Admin not found', 'ADMIN_NOT_FOUND');
      const removesSuper = current.role === 'SUPER_ADMIN' && current.isActive && (data.isActive === false || data.role === 'ADMIN');
      if (removesSuper) {
        const count = await tx.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
        if (count <= 1) throw new AppError(409, 'At least one active SUPER_ADMIN is required', 'LAST_SUPER_ADMIN');
      }
      const updated = await tx.user.update({ where: { id }, data });
      if (data.isActive === false) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'User', entityId: id, action: 'ADMIN_UPDATE', before: auditJson(mapAdminUser(current)), after: auditJson(mapAdminUser(updated)) } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ admin: mapAdminUser(result) });
  } catch (error) { next(error); }
});
