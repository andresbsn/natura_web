import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminCatalogsRouter = Router();
adminCatalogsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const catalogFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().optional(),
});
const catalogSchema = catalogFieldsSchema.refine((data) => data.startsAt < data.endsAt, { message: 'startsAt must be before endsAt', path: ['endsAt'] });
export const catalogPriceSchema = z.object({ variantId: z.string().uuid(), amount: z.number().positive().nullable() });
const bulkSchema = z.object({ prices: z.array(catalogPriceSchema).min(1).max(1000) });

function auditJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
type CatalogResponse = object & { prices?: Array<{ amount: Prisma.Decimal }> };
function mapCatalog(catalog: CatalogResponse) {
  const prices = 'prices' in catalog && catalog.prices
    ? catalog.prices.map((price) => ({ ...price, amount: price.amount.toNumber() }))
    : undefined;
  return prices ? { ...catalog, prices } : catalog;
}

adminCatalogsRouter.get('/catalogs', async (_req, res, next) => {
  try { res.json({ catalogs: (await prisma.catalog.findMany({ orderBy: { startsAt: 'desc' }, include: { prices: true } })).map(mapCatalog) }); }
  catch (error) { next(error); }
});

adminCatalogsRouter.post('/catalogs', async (req, res, next) => {
  try {
    const data = catalogSchema.parse(req.body);
    const catalog = await prisma.$transaction(async (tx) => {
      const created = await tx.catalog.create({ data: { ...data, isActive: data.isActive ?? true } });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'Catalog', entityId: created.id, action: 'CREATE', after: auditJson(created) } });
      return created;
    });
    res.status(201).json({ catalog: mapCatalog(catalog) });
  } catch (error) { next(error); }
});

adminCatalogsRouter.patch('/catalogs/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await prisma.catalog.findUnique({ where: { id }, include: { prices: true } });
    if (!existing) throw new AppError(404, 'Catalog not found', 'CATALOG_NOT_FOUND');
    const data = catalogFieldsSchema.partial().parse({ ...existing, ...req.body });
    if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) throw new AppError(400, 'startsAt must be before endsAt', 'INVALID_CATALOG_DATES');
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.catalog.update({ where: { id }, data });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'Catalog', entityId: id, action: 'UPDATE', before: auditJson(existing), after: auditJson(value) } });
      return value;
    });
    res.json({ catalog: mapCatalog(updated) });
  } catch (error) { next(error); }
});

adminCatalogsRouter.delete('/catalogs/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await prisma.catalog.findUnique({ where: { id }, include: { prices: true } });
    if (!existing) throw new AppError(404, 'Catalog not found', 'CATALOG_NOT_FOUND');
    const catalog = await prisma.$transaction(async (tx) => {
      const deactivated = await tx.catalog.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'Catalog', entityId: id, action: 'DEACTIVATE', before: auditJson(existing), after: auditJson(deactivated) } });
      return deactivated;
    });
    res.json({ catalog: mapCatalog(catalog) });
  } catch (error) { next(error); }
});

adminCatalogsRouter.put('/catalogs/:id/prices', async (req, res, next) => {
  try {
    const catalogId = z.string().uuid().parse(req.params.id);
    const { prices } = bulkSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const catalog = await tx.catalog.findUnique({ where: { id: catalogId } });
      if (!catalog) throw new AppError(404, 'Catalog not found', 'CATALOG_NOT_FOUND');
      const variantIds = [...new Set(prices.map((price) => price.variantId))];
      const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true } });
      if (variants.length !== variantIds.length) throw new AppError(400, 'All variants must be active products', 'INVALID_CATALOG_VARIANTS');
      for (const price of prices) {
        if (price.amount === null) {
          await tx.price.deleteMany({ where: { variantId: price.variantId, catalogId } });
        } else {
          await tx.price.upsert({ where: { variantId_catalogId: { variantId: price.variantId, catalogId } }, update: { amount: price.amount }, create: { variantId: price.variantId, catalogId, amount: price.amount } });
        }
      }
      const rows = await tx.price.findMany({ where: { catalogId }, orderBy: { variantId: 'asc' } });
      await tx.auditLog.create({ data: { actorId: req.user!.id, entityType: 'CatalogPrice', entityId: catalogId, action: 'BULK_UPSERT', after: auditJson(rows) } });
      return rows;
    });
    res.json({ catalogId, prices: result.map((price) => ({ ...price, amount: price.amount.toNumber() })) });
  } catch (error) { next(error); }
});
