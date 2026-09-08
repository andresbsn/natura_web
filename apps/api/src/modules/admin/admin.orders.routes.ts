import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { sendOrderStatusEmail } from '../notifications/order-email-notifications.js';
import { mapOrder, orderInclude } from '../orders/order.mappers.js';
import { RESERVED_ORDER_STATUSES, assertAdminOrderStatusTransition, orderItemQuantityDiffs, orderStockAction, recalculateOrderItems } from '../orders/order-stock.js';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const orderUpdateSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  deliveryMethodId: z.string().uuid().nullable().optional(),
  deliveryAddress: z.string().max(300).nullable().optional(),
  deliveryNotes: z.string().max(600).nullable().optional(),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).optional(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['efectivo', 'transferencia', 'debito', 'credito']),
  notes: z.string().max(600).optional(),
});

const deliveryMethodSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  cost: z.number().min(0),
  requiresAddress: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapDeliveryMethod(method: {
  id: string;
  name: string;
  description: string | null;
  cost: Prisma.Decimal;
  requiresAddress: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: method.id,
    name: method.name,
    description: method.description,
    cost: method.cost.toNumber(),
    requiresAddress: method.requiresAddress,
    isActive: method.isActive,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}

adminOrdersRouter.get('/delivery-methods', async (_req, res, next) => {
  try {
    const deliveryMethods = await prisma.deliveryMethod.findMany({ orderBy: { name: 'asc' } });
    res.json({ deliveryMethods: deliveryMethods.map(mapDeliveryMethod) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.post('/delivery-methods', async (req, res, next) => {
  try {
    const data = deliveryMethodSchema.parse(req.body);
    const deliveryMethod = await prisma.deliveryMethod.create({
      data: {
        name: data.name,
        description: data.description,
        cost: data.cost,
        requiresAddress: data.requiresAddress ?? true,
        isActive: data.isActive ?? true,
      },
    });

    res.status(201).json({ deliveryMethod: mapDeliveryMethod(deliveryMethod) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.patch('/delivery-methods/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = deliveryMethodSchema.partial().parse(req.body);
    const deliveryMethod = await prisma.deliveryMethod.update({ where: { id }, data });
    res.json({ deliveryMethod: mapDeliveryMethod(deliveryMethod) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.get('/orders', async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });

    res.json({ orders: orders.map(mapOrder) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.patch('/orders/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = orderUpdateSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id }, include: orderInclude });

    if (!existing) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    assertAdminOrderStatusTransition(existing.status, data.status);

    if (data.items && !RESERVED_ORDER_STATUSES.includes(existing.status)) {
      throw new AppError(409, 'Only active reserved orders can be edited', 'ORDER_NOT_EDITABLE');
    }

    if (data.items && data.status && data.status !== existing.status) {
      throw new AppError(409, 'Edit order items before changing operational status', 'ORDER_EDIT_STATUS_CONFLICT');
    }

    const order = await prisma.$transaction(async (tx) => {
      const stockAction = orderStockAction(existing.status, data.status);
      const nextDeliveryMethod = data.deliveryMethodId
        ? await tx.deliveryMethod.findFirst({ where: { id: data.deliveryMethodId, isActive: true } })
        : null;

      if (data.deliveryMethodId && !nextDeliveryMethod) {
        throw new AppError(400, 'Delivery method is not available', 'DELIVERY_METHOD_UNAVAILABLE');
      }

      const deliveryCost = data.deliveryMethodId === undefined ? existing.deliveryCost : nextDeliveryMethod?.cost ?? new Prisma.Decimal(0);
      let nextSubtotal = existing.subtotal;
      let nextDiscountTotal = existing.discountTotal;
      let itemCreateData: ReturnType<typeof recalculateOrderItems>['items'] | undefined;

      if (stockAction || data.items) {
        const variantIds = [...new Set([...(data.items?.map((item) => item.variantId) ?? []), ...existing.items.map((item) => item.variantId)])];
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(variantIds)}) FOR UPDATE`;
      }

      if (data.items) {
        const variantIds = [...new Set(data.items.map((item) => item.variantId))];
        const variants = await tx.productVariant.findMany({
          where: { id: { in: variantIds }, isActive: true, product: { isActive: true } },
          include: {
            product: { include: { category: { include: { promotions: true } }, promotions: true } },
            prices: { orderBy: { createdAt: 'desc' }, take: 1, include: { catalog: { include: { promotions: true } } } },
            promotions: true,
          },
        });
        const reservations = await tx.orderItem.groupBy({
          by: ['variantId'],
          where: {
            variantId: { in: variantIds },
            orderId: { not: id },
            order: { status: { in: RESERVED_ORDER_STATUSES } },
          },
          _sum: { quantity: true },
        });
        const reservedByVariantId = new Map(reservations.map((reservation) => [reservation.variantId, reservation._sum.quantity ?? 0]));
        const { items, subtotal } = recalculateOrderItems(data.items, variants);

        for (const item of items) {
          const variant = variants.find((candidate) => candidate.id === item.variantId);
          const availableStock = (variant?.stockQuantity ?? 0) - (reservedByVariantId.get(item.variantId) ?? 0);

          if (availableStock < item.quantity) {
            throw new AppError(409, `Stock insuficiente para ${item.productNameSnapshot}`, 'INSUFFICIENT_STOCK');
          }
        }

        nextSubtotal = subtotal;
        nextDiscountTotal = items.reduce((total, item) => total.add(item.discountAmount.mul(item.quantity)), new Prisma.Decimal(0));
        itemCreateData = items;
      }

      if (itemCreateData) {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({ data: itemCreateData.map((item) => ({ ...item, orderId: id })) });

        const diffs = orderItemQuantityDiffs(existing.items, itemCreateData);
        if (diffs.length > 0) {
          await tx.stockMovement.createMany({
            data: diffs.map((diff) => ({
              variantId: diff.variantId,
              orderId: id,
              actorId: req.user!.id,
              type: 'ORDER_ADJUSTED',
              quantity: diff.quantity,
              reason: 'Edicion admin de items del pedido',
            })),
          });
        }
      }

      const nextTotal = nextSubtotal.add(deliveryCost);
      const shouldRecalculatePaymentStatus = data.paymentStatus === undefined && (data.items !== undefined || data.deliveryMethodId !== undefined);
      const paidTotal = existing.payments.reduce((total, payment) => total.add(payment.amount), new Prisma.Decimal(0));
      const nextPaymentStatus = shouldRecalculatePaymentStatus
        ? paidTotal.equals(0)
          ? 'UNPAID'
          : paidTotal.greaterThanOrEqualTo(nextTotal)
            ? 'PAID'
            : 'PARTIALLY_PAID'
        : data.paymentStatus;

      const updated = await tx.order.update({
        where: { id },
        data: {
          status: data.status,
          paymentStatus: nextPaymentStatus,
          deliveryMethodId: data.deliveryMethodId === undefined ? undefined : nextDeliveryMethod?.id ?? null,
          deliveryAddress: data.deliveryAddress,
          deliveryNotes: data.deliveryNotes,
          subtotal: nextSubtotal,
          discountTotal: nextDiscountTotal,
          deliveryCost,
          total: nextTotal,
          cancelledAt: data.status === 'CANCELLED' && !existing.cancelledAt ? new Date() : existing.cancelledAt,
        },
        include: orderInclude,
      });

      if (stockAction?.decrementStock) {
        await Promise.all(
          existing.items.map(async (item) => {
            const updated = await tx.productVariant.updateMany({
              where: { id: item.variantId, stockQuantity: { gte: item.quantity } },
              data: { stockQuantity: { decrement: item.quantity } },
            });

            if (updated.count !== 1) {
              throw new AppError(409, 'Stock insuficiente para entregar el pedido', 'INSUFFICIENT_STOCK');
            }
          }),
        );
      }

      if (stockAction) {
        await tx.stockMovement.createMany({
          data: existing.items.map((item) => ({
            variantId: item.variantId,
            orderId: id,
            actorId: req.user!.id,
            type: stockAction.movementType,
            quantity: item.quantity,
            reason: stockAction.reason,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'Order',
          entityId: id,
          action: 'UPDATE',
          before: auditJson(existing),
          after: auditJson(updated),
        },
      });

      return updated;
    });

    if (data.status && data.status !== existing.status) {
      await sendOrderStatusEmail({
        orderId: order.id,
        customerId: order.customerId,
        customerEmail: order.customerEmail,
        customerFirstName: order.customerFirstName,
        status: order.status,
        previousStatus: existing.status,
        total: order.total,
      });
    }

    res.json({ order: mapOrder(order) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.post('/orders/:id/payments', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = paymentSchema.parse(req.body);
    const existing = await prisma.order.findUnique({ where: { id } });

    if (!existing) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    const paidTotal = await prisma.payment.aggregate({ where: { orderId: id }, _sum: { amount: true } });
    const nextPaidTotal = (paidTotal._sum.amount ?? new Prisma.Decimal(0)).add(data.amount);
    const nextStatus = nextPaidTotal.greaterThanOrEqualTo(existing.total) ? 'PAID' : 'PARTIALLY_PAID';

    const order = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: id,
          registeredById: req.user!.id,
          amount: data.amount,
          status: nextStatus,
          method: data.method,
          notes: data.notes,
          paidAt: new Date(),
        },
      });

      return tx.order.update({
        where: { id },
        data: { paymentStatus: nextStatus },
        include: orderInclude,
      });
    });

    res.status(201).json({ order: mapOrder(order) });
  } catch (error) {
    next(error);
  }
});
