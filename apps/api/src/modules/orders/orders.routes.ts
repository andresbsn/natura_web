import { CustomerAccountMovementType, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { createLedgerMovement } from '../accounts/account-ledger.js';
import { requireAuth, requireRole, requireVerifiedActiveUser } from '../auth/auth.middleware.js';
import { mapOrder, orderInclude } from './order.mappers.js';
import { RESERVED_ORDER_STATUSES, recalculateOrderItems } from './order-stock.js';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);
ordersRouter.use(requireRole('CUSTOMER'));
ordersRouter.use(requireVerifiedActiveUser);

const orderItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

const orderCreateSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  deliveryMethodId: z.string().uuid().optional(),
  deliveryAddress: z.string().max(300).optional(),
  deliveryNotes: z.string().max(600).optional(),
});

ordersRouter.get('/', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { customerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });

    res.json({ orders: orders.map(mapOrder) });
  } catch (error) {
    next(error);
  }
});

ordersRouter.post('/', async (req, res, next) => {
  try {
    const data = orderCreateSchema.parse(req.body);
    const order = await prisma.$transaction(async (tx) => {
      const customer = await tx.user.findUnique({ where: { id: req.user!.id } });

      if (!customer || !customer.isActive) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
      }

      if (!customer.emailVerifiedAt) {
        throw new AppError(403, 'Email verification required', 'EMAIL_VERIFICATION_REQUIRED');
      }

      const variantIds = [...new Set(data.items.map((item) => item.variantId))];
      const requestedByVariantId = data.items.reduce((totals, item) => {
        totals.set(item.variantId, (totals.get(item.variantId) ?? 0) + item.quantity);
        return totals;
      }, new Map<string, number>());

      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(variantIds)}) FOR UPDATE`;
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, isActive: true, product: { isActive: true } },
        include: {
          product: { include: { category: { include: { promotions: true } }, promotions: true } },
          prices: { orderBy: { createdAt: 'desc' }, include: { catalog: { include: { promotions: true } } } },
          promotions: true,
        },
      });
      const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
      const reservations = await tx.orderItem.groupBy({
        by: ['variantId'],
        where: {
          variantId: { in: variantIds },
          order: { status: { in: RESERVED_ORDER_STATUSES } },
        },
        _sum: { quantity: true },
      });
      const reservedByVariantId = new Map(reservations.map((reservation) => [reservation.variantId, reservation._sum.quantity ?? 0]));
      const deliveryMethod = data.deliveryMethodId
        ? await tx.deliveryMethod.findFirst({ where: { id: data.deliveryMethodId, isActive: true } })
        : null;

      if (data.deliveryMethodId && !deliveryMethod) {
        throw new AppError(400, 'Delivery method is not available', 'DELIVERY_METHOD_UNAVAILABLE');
      }

      const orderItems = data.items.map((item) => {
        const variant = variantsById.get(item.variantId);
        if (!variant) {
          throw new AppError(400, 'Product is not available', 'PRODUCT_UNAVAILABLE');
        }

        const availableStock = variant.stockQuantity - (reservedByVariantId.get(variant.id) ?? 0);

        if (availableStock < (requestedByVariantId.get(variant.id) ?? item.quantity)) {
          throw new AppError(409, `Stock insuficiente para ${variant.product.name}`, 'INSUFFICIENT_STOCK');
        }

        const promotion = recalculateOrderItems([{ variantId: variant.id, quantity: item.quantity }], [variant]).items[0];
        const unitPrice = promotion.unitPrice;
        const lineTotal = unitPrice.mul(item.quantity);

        return {
          variantId: variant.id,
          productNameSnapshot: variant.product.name,
          variantNameSnapshot: variant.name,
          skuSnapshot: variant.sku,
          unitPrice,
          discountAmount: promotion.discountAmount,
          quantity: item.quantity,
          lineTotal,
        };
      });
      const subtotal = orderItems.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0));
      const discountTotal = orderItems.reduce((total, item) => total.add(item.discountAmount.mul(item.quantity)), new Prisma.Decimal(0));
      const deliveryCost = deliveryMethod?.cost ?? new Prisma.Decimal(0);
      const total = subtotal.add(deliveryCost);

      const created = await tx.order.create({
        data: {
          customerId: customer.id,
          deliveryMethodId: deliveryMethod?.id,
          customerFirstName: customer.firstName,
          customerLastName: customer.lastName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          deliveryAddress: data.deliveryAddress,
          deliveryNotes: data.deliveryNotes,
          subtotal,
          discountTotal,
          deliveryCost,
          total,
          items: { create: orderItems },
        },
        include: orderInclude,
      });

      await tx.stockMovement.createMany({
        data: data.items.map((item) => ({
          variantId: item.variantId,
          orderId: created.id,
          actorId: customer.id,
          type: 'ORDER_RESERVED',
          quantity: item.quantity,
          reason: 'Reserva por pedido cliente',
        })),
      });

      await createLedgerMovement(tx, {
        customerId: customer.id,
        orderId: created.id,
        actorId: customer.id,
        type: CustomerAccountMovementType.ORDER_CHARGE,
        direction: 'DEBIT',
        amount: total,
        description: `Cargo por pedido ${created.id.slice(0, 8)}`,
        idempotencyKey: `order:${created.id}:charge`,
        metadata: { source: 'order_create' },
        occurredAt: created.createdAt,
      });

      return created;
    });

    res.status(201).json({ order: mapOrder(order) });
  } catch (error) {
    next(error);
  }
});

ordersRouter.patch('/:id/cancel', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.order.findFirst({
        where: { id, customerId: req.user!.id },
        include: { items: true },
      });

      if (!existing) {
        throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
      }

      if (existing.status !== 'PENDING') {
        throw new AppError(409, 'Only pending orders can be cancelled by customer', 'ORDER_NOT_CANCELLABLE');
      }

      const updated = await tx.order.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
        include: orderInclude,
      });

      await tx.stockMovement.createMany({
        data: existing.items.map((item) => ({
          variantId: item.variantId,
          orderId: id,
          actorId: req.user!.id,
          type: 'ORDER_RELEASED',
          quantity: item.quantity,
          reason: 'Cancelacion cliente',
        })),
      });

      await createLedgerMovement(tx, {
        customerId: existing.customerId,
        orderId: id,
        actorId: req.user!.id,
        type: CustomerAccountMovementType.ORDER_CANCEL_CREDIT,
        direction: 'CREDIT',
        amount: existing.total,
        description: `Credito por cancelacion del pedido ${id.slice(0, 8)}`,
        idempotencyKey: `order:${id}:cancel-credit`,
        metadata: { source: 'customer_cancel' },
      });

      return updated;
    });

    res.json({ order: mapOrder(order) });
  } catch (error) {
    next(error);
  }
});
