import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';

export const adminReportsRouter = Router();
adminReportsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, date] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
}, 'Invalid calendar date');
const querySchema = z.object({ from: dateSchema, to: dateSchema, lowStockThreshold: z.coerce.number().int().min(0).max(1000).default(5) });
function argentinaBoundary(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  // Argentina has used UTC-03:00 since 2009; boundaries are explicit and half-open.
  return new Date(Date.UTC(year, month - 1, date, 3, 0, 0, 0));
}
function nextDay(value: Date) { return new Date(value.getTime() + 86400000); }
adminReportsRouter.get('/reports', async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    if (query.from > query.to) return res.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'from must not be after to' } });
    const from = argentinaBoundary(query.from);
    const to = nextDay(argentinaBoundary(query.to));
    const days = (to.getTime() - from.getTime()) / 86400000;
    if (days > 366) return res.status(400).json({ error: { code: 'DATE_RANGE_TOO_LARGE', message: 'Date range cannot exceed 366 days' } });
    const [sales, byStatus, topProducts, lowStock, payments, byDelivery, pending] = await Promise.all([
      prisma.order.aggregate({ where: { status: 'DELIVERED', OR: [{ deliveredAt: { gte: from, lt: to } }, { deliveredAt: null, createdAt: { gte: from, lt: to } }] }, _count: true, _sum: { total: true } }),
      prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: from, lt: to } }, _count: true }),
      prisma.orderItem.groupBy({ by: ['variantId'], where: { order: { status: 'DELIVERED', OR: [{ deliveredAt: { gte: from, lt: to } }, { deliveredAt: null, createdAt: { gte: from, lt: to } }] } }, _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 20 }),
      prisma.productVariant.findMany({ where: { isActive: true, stockQuantity: { lte: query.lowStockThreshold } }, include: { product: { select: { name: true, slug: true } } }, orderBy: { stockQuantity: 'asc' } }),
      prisma.payment.aggregate({ where: { status: { not: 'REFUNDED' }, OR: [{ paidAt: { gte: from, lt: to } }, { paidAt: null, createdAt: { gte: from, lt: to } }] }, _sum: { amount: true } }),
      prisma.order.groupBy({ by: ['deliveryMethodId'], where: { status: 'DELIVERED', OR: [{ deliveredAt: { gte: from, lt: to } }, { deliveredAt: null, createdAt: { gte: from, lt: to } }] }, _count: true, _sum: { total: true } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
    ]);
    const variants = await prisma.productVariant.findMany({ where: { id: { in: topProducts.map((p) => p.variantId) } }, select: { id: true, name: true, sku: true, product: { select: { name: true } } } });
     res.json({ timezone: 'America/Argentina/Buenos_Aires', period: { fromInclusive: query.from, toInclusive: query.to, toExclusive: nextDay(argentinaBoundary(query.to)).toISOString() }, sales: { orderCount: sales._count, total: (sales._sum.total ?? new Prisma.Decimal(0)).toNumber() }, ordersByStatus: byStatus.map((item) => ({ status: item.status, count: item._count })), topProducts: topProducts.map((item) => ({ ...variants.find((v) => v.id === item.variantId), quantity: item._sum.quantity ?? 0, total: (item._sum.lineTotal ?? new Prisma.Decimal(0)).toNumber() })), lowStock: lowStock.map((item) => ({ variantId: item.id, sku: item.sku, name: item.name, productName: item.product.name, stockQuantity: item.stockQuantity })), income: { total: (payments._sum.amount ?? new Prisma.Decimal(0)).toNumber() }, salesByDeliveryMethod: byDelivery.map((item) => ({ deliveryMethodId: item.deliveryMethodId, count: item._count, total: (item._sum.total ?? new Prisma.Decimal(0)).toNumber() })), pendingOrders: pending });
  } catch (error) { next(error); }
});
