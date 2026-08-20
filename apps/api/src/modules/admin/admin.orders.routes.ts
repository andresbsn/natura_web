import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { sendOrderStatusEmail } from '../notifications/order-email-notifications.js';
import { mapOrder, orderInclude } from '../orders/order.mappers.js';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const orderUpdateSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().max(80).optional(),
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

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          status: data.status,
          paymentStatus: data.paymentStatus,
          cancelledAt: data.status === 'CANCELLED' && !existing.cancelledAt ? new Date() : existing.cancelledAt,
        },
        include: orderInclude,
      });

      if (data.status === 'CANCELLED' && existing.status !== 'CANCELLED') {
        await tx.stockMovement.createMany({
          data: existing.items.map((item) => ({
            variantId: item.variantId,
            orderId: id,
            actorId: req.user!.id,
            type: 'ORDER_RELEASED',
            quantity: item.quantity,
            reason: 'Cancelacion admin',
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
