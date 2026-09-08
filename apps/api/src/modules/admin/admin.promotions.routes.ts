import { DiscountType, Prisma, PromotionScope } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminPromotionsRouter = Router();

adminPromotionsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const nullableDateSchema = z.preprocess((value) => (value ? new Date(String(value)) : null), z.date().nullable());

const promotionSchema = z.object({
  name: z.string().min(1).max(160),
  scope: z.nativeEnum(PromotionScope),
  discountType: z.nativeEnum(DiscountType),
  value: z.number().positive(),
  priority: z.number().int().min(0).default(0),
  startsAt: nullableDateSchema.optional(),
  endsAt: nullableDateSchema.optional(),
  isActive: z.boolean().optional(),
  productId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  catalogId: z.string().uuid().nullable().optional(),
});

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function targetForScope(data: z.infer<typeof promotionSchema>) {
  return {
    productId: data.scope === 'PRODUCT' ? data.productId : null,
    variantId: data.scope === 'VARIANT' ? data.variantId : null,
    categoryId: data.scope === 'CATEGORY' ? data.categoryId : null,
    catalogId: data.scope === 'CATALOG' ? data.catalogId : null,
  };
}

function assertPromotionTarget(data: z.infer<typeof promotionSchema>) {
  const target = targetForScope(data);
  const hasTarget = Boolean(target.productId || target.variantId || target.categoryId || target.catalogId);

  if (!hasTarget) {
    throw new AppError(400, 'Promotion target is required for selected scope', 'PROMOTION_TARGET_REQUIRED');
  }

  if (data.startsAt && data.endsAt && data.startsAt > data.endsAt) {
    throw new AppError(400, 'Promotion start date must be before end date', 'INVALID_PROMOTION_DATES');
  }
}

function mapPromotion(promotion: {
  id: string;
  name: string;
  scope: PromotionScope;
  discountType: DiscountType;
  value: Prisma.Decimal;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  productId: string | null;
  variantId: string | null;
  categoryId: string | null;
  catalogId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...promotion, value: promotion.value.toNumber() };
}

adminPromotionsRouter.get('/promotions', async (_req, res, next) => {
  try {
    const promotions = await prisma.promotion.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    res.json({ promotions: promotions.map(mapPromotion) });
  } catch (error) {
    next(error);
  }
});

adminPromotionsRouter.post('/promotions', async (req, res, next) => {
  try {
    const data = promotionSchema.parse(req.body);
    assertPromotionTarget(data);
    const target = targetForScope(data);
    const promotion = await prisma.$transaction(async (tx) => {
      const created = await tx.promotion.create({
        data: {
          name: data.name,
          scope: data.scope,
          discountType: data.discountType,
          value: data.value,
          priority: data.priority,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          isActive: data.isActive ?? true,
          ...target,
        },
      });

      await tx.auditLog.create({
        data: { actorId: req.user!.id, entityType: 'Promotion', entityId: created.id, action: 'CREATE', after: auditJson(created) },
      });

      return created;
    });

    res.status(201).json({ promotion: mapPromotion(promotion) });
  } catch (error) {
    next(error);
  }
});

adminPromotionsRouter.patch('/promotions/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await prisma.promotion.findUnique({ where: { id } });

    if (!existing) {
      throw new AppError(404, 'Promotion not found', 'PROMOTION_NOT_FOUND');
    }

    const data = promotionSchema.parse({ ...existing, value: existing.value.toNumber(), ...req.body });
    assertPromotionTarget(data);
    const target = targetForScope(data);
    const promotion = await prisma.$transaction(async (tx) => {
      const updated = await tx.promotion.update({
        where: { id },
        data: {
          name: data.name,
          scope: data.scope,
          discountType: data.discountType,
          value: data.value,
          priority: data.priority,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          isActive: data.isActive,
          ...target,
        },
      });

      await tx.auditLog.create({
        data: { actorId: req.user!.id, entityType: 'Promotion', entityId: id, action: 'UPDATE', before: auditJson(existing), after: auditJson(updated) },
      });

      return updated;
    });

    res.json({ promotion: mapPromotion(promotion) });
  } catch (error) {
    next(error);
  }
});
