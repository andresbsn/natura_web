import { CustomerAccountMovementType, OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { calculateCancellationEffect, calculatePaymentReversalEffect, calculatePaymentStatus, canReduceOrderTotal, createLedgerMovement, isUniqueConstraintError, reclassifyPaymentsForCancellation, reclassifyPaymentsForReducedTotal, runAccountingTransaction, splitPayment, totalAdjustmentMovementKey } from '../accounts/account-ledger.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { sendOrderStatusEmail, sendPaymentReceiptEmail } from '../notifications/order-email-notifications.js';
import { formatOrderNumber, mapOrder, orderInclude } from '../orders/order.mappers.js';
import { RESERVED_ORDER_STATUSES, assertAdminOrderStatusTransition, assertOrderIsMutable, orderItemQuantityDiffs, orderStockAction, recalculateOrderItems } from '../orders/order-stock.js';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const orderUpdateSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  deliveryMethodId: z.string().uuid().nullable().optional(),
  deliveryAddress: z.string().max(300).nullable().optional(),
  deliveryNotes: z.string().max(600).nullable().optional(),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).optional(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
  method: z.enum(['efectivo', 'transferencia', 'debito', 'credito']),
  notes: z.string().max(600).optional(),
});

const paymentReversalSchema = z.object({
  reason: z.string().trim().min(3).max(600),
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

async function orderPaymentStatus(tx: Prisma.TransactionClient, orderId: string, total: Prisma.Decimal) {
  const [payments, historicalPayments, applications, historicalApplications] = await Promise.all([
    tx.payment.aggregate({ where: { orderId, status: { not: 'REFUNDED' } }, _sum: { appliedAmount: true }, _count: true }),
    tx.payment.count({ where: { orderId } }),
    tx.creditApplication.aggregate({ where: { destinationOrderId: orderId, reversedAt: null }, _sum: { remainingAmount: true }, _count: true }),
    tx.creditApplication.count({ where: { destinationOrderId: orderId } }),
  ]);
  return calculatePaymentStatus(
    total,
    payments._sum.appliedAmount ?? new Prisma.Decimal(0),
    applications._sum.remainingAmount ?? new Prisma.Decimal(0),
    historicalPayments > 0 || historicalApplications > 0,
  );
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

adminOrdersRouter.get('/orders', async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.nativeEnum(OrderStatus).optional(), search: z.string().trim().min(1).max(120).optional() }).parse(req.query);
    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    const parsedSearchOrderNumber = query.search && /^\d+$/.test(query.search) ? Number(query.search) : undefined;
    const searchOrderNumber = parsedSearchOrderNumber !== undefined && Number.isSafeInteger(parsedSearchOrderNumber) ? parsedSearchOrderNumber : undefined;
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ id: { contains: query.search, mode: 'insensitive' as const } }, { customerEmail: { contains: query.search, mode: 'insensitive' as const } }, ...(searchOrderNumber === undefined ? [] : [{ orderNumber: searchOrderNumber }])] } : {}) };
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, include: orderInclude, ...(paginate ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) }),
      prisma.order.count({ where }),
    ]);

    res.json({ orders: orders.map(mapOrder), pagination: { page: query.page, pageSize: paginate ? query.pageSize : total, total, totalPages: paginate ? Math.ceil(total / query.pageSize) : 1 } });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.patch('/orders/:id', async (req, res, next) => {
  let id = '';
  let data = {} as z.infer<typeof orderUpdateSchema>;
  try {
    id = z.string().uuid().parse(req.params.id);
    data = orderUpdateSchema.parse(req.body);
    let previousStatus: OrderStatus | null = null;

    const order = await runAccountingTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.order.findUnique({ where: { id }, include: orderInclude });

      if (!existing) {
        throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
      }

      if (existing.status === 'CANCELLED') {
        assertOrderIsMutable(existing.status);
      }

      previousStatus = existing.status;
      assertAdminOrderStatusTransition(existing.status, data.status);

      if (data.items && !RESERVED_ORDER_STATUSES.includes(existing.status)) {
        throw new AppError(409, 'Only active reserved orders can be edited', 'ORDER_NOT_EDITABLE');
      }

      if ((existing.status === 'CANCELLED' || existing.status === 'DELIVERED') && (data.items !== undefined || data.deliveryMethodId !== undefined)) {
        throw new AppError(409, 'Closed orders cannot change totals', 'ORDER_TOTAL_LOCKED');
      }

      if (data.items && data.status && data.status !== existing.status) {
        throw new AppError(409, 'Edit order items before changing operational status', 'ORDER_EDIT_STATUS_CONFLICT');
      }

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
          where: { id: { in: variantIds } },
          include: {
            product: { include: { category: { include: { promotions: true } }, promotions: true } },
            prices: { orderBy: { createdAt: 'desc' }, include: { catalog: { include: { promotions: true } } } },
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
        const { items, subtotal } = recalculateOrderItems(data.items, variants, existing.items);

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
      if (data.status === 'CANCELLED' && !nextTotal.equals(existing.total)) {
        throw new AppError(409, 'Cancel the order before changing its total', 'ORDER_TOTAL_LOCKED');
      }
      const activeApplicationTotal = await tx.creditApplication.aggregate({ where: { destinationOrderId: id, reversedAt: null }, _sum: { remainingAmount: true } });
      const activeCreditApplied = activeApplicationTotal._sum.remainingAmount ?? new Prisma.Decimal(0);
      if (!canReduceOrderTotal(nextTotal, activeCreditApplied)) {
        throw new AppError(409, 'Order total cannot be lower than active applied credit', 'ORDER_TOTAL_BELOW_APPLIED_CREDIT');
      }
      let totalAdjustmentDebtDelta = new Prisma.Decimal(0);
      let totalAdjustmentCreditDelta = new Prisma.Decimal(0);
      const totalAdjustmentKey = data.idempotencyKey ?? randomUUID();
      if (!nextTotal.equals(existing.total)) {
        const existingAdjustment = await tx.customerAccountMovement.findUnique({ where: { idempotencyKey: totalAdjustmentMovementKey(id, totalAdjustmentKey) } });
        if (existingAdjustment) {
          throw new AppError(409, 'Idempotency key was already used for another total adjustment', 'IDEMPOTENCY_KEY_CONFLICT');
        }
        if (nextTotal.lessThan(existing.total)) {
          await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" = ${id} ORDER BY "createdAt", id FOR UPDATE`;
          const payments = await tx.payment.findMany({ where: { orderId: id }, select: { id: true, amount: true, appliedAmount: true, creditAmount: true, status: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
          const reclassified = reclassifyPaymentsForReducedTotal(payments, nextTotal, activeCreditApplied);
          const oldApplied = payments.filter((payment) => payment.status !== 'REFUNDED').reduce((sum, payment) => sum.add(payment.appliedAmount), new Prisma.Decimal(0));
          const oldCredit = payments.filter((payment) => payment.status !== 'REFUNDED').reduce((sum, payment) => sum.add(payment.creditAmount), new Prisma.Decimal(0));
          const newApplied = reclassified.reduce((sum, payment) => sum.add(payment.appliedAmount), new Prisma.Decimal(0));
          const newCredit = reclassified.reduce((sum, payment) => sum.add(payment.creditAmount), new Prisma.Decimal(0));
          for (const payment of reclassified) {
            await tx.payment.update({ where: { id: payment.id }, data: { appliedAmount: payment.appliedAmount, creditAmount: payment.creditAmount } });
          }
          totalAdjustmentDebtDelta = nextTotal.sub(existing.total).sub(newApplied.sub(oldApplied));
          totalAdjustmentCreditDelta = newCredit.sub(oldCredit);
        } else {
          totalAdjustmentDebtDelta = nextTotal.sub(existing.total);
        }
      }
      const nextPaymentStatus = await orderPaymentStatus(tx, id, nextTotal);

      let updated = await tx.order.update({
        where: { id },
        data: {
          status: data.status,
          deliveredAt: data.status === 'DELIVERED' && existing.status !== 'DELIVERED' ? new Date() : undefined,
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

      if (updated.status === 'CANCELLED' && existing.status !== 'CANCELLED') {
        const cancellationPaymentRows = await tx.payment.findMany({
          where: { orderId: id, status: { not: 'REFUNDED' }, reversedAt: null },
          select: { id: true, appliedAmount: true, creditAmount: true, status: true, reversedAt: true },
        });
        const appliedCredits = await tx.creditApplication.findMany({ where: { destinationOrderId: id } });
        const appliedPaymentAmount = cancellationPaymentRows.reduce((sum, payment) => sum.add(payment.appliedAmount), new Prisma.Decimal(0));
        for (const payment of reclassifyPaymentsForCancellation(cancellationPaymentRows)) {
          await tx.payment.update({ where: { id: payment.id }, data: { appliedAmount: payment.appliedAmount, creditAmount: payment.creditAmount } });
        }
        const appliedCreditAmount = appliedCredits.reduce((sum, application) => sum.add(application.remainingAmount), new Prisma.Decimal(0));
        const cancellationEffect = calculateCancellationEffect(existing.total, appliedPaymentAmount, appliedCreditAmount);
        const outstandingDebt = cancellationEffect.debtToRelease;
        if (outstandingDebt.greaterThan(0) || appliedPaymentAmount.greaterThan(0)) {
          await createLedgerMovement(tx, {
          customerId: existing.customerId,
          orderId: id,
          actorId: req.user!.id,
          type: CustomerAccountMovementType.ORDER_CANCEL_CREDIT,
          direction: 'CREDIT',
          amount: outstandingDebt.greaterThan(0) ? outstandingDebt : appliedPaymentAmount,
          debtDelta: outstandingDebt.greaterThan(0) ? outstandingDebt.mul(-1) : new Prisma.Decimal(0),
          creditDelta: appliedPaymentAmount,
          description: `Reversion del saldo pendiente por cancelacion del pedido ${id.slice(0, 8)}`,
          idempotencyKey: `order:${id}:cancel-credit`,
          metadata: auditJson({ source: 'admin_cancel', previousStatus: existing.status }),
          });
        }

        for (const application of appliedCredits.filter((candidate) => candidate.remainingAmount.greaterThan(0))) {
          await tx.creditApplication.update({
            where: { id: application.id },
            data: { remainingAmount: 0, reversedAt: new Date(), reversedById: req.user!.id, reversalReason: 'Pedido cancelado por admin' },
          });
          await tx.paymentCreditAllocation.updateMany({
            where: { creditApplicationId: application.id, reversedAt: null },
            data: { reversedAt: new Date(), reversedById: req.user!.id, reversalReason: 'Pedido destino cancelado' },
          });
          await createLedgerMovement(tx, {
            customerId: existing.customerId,
            orderId: id,
            actorId: req.user!.id,
            type: CustomerAccountMovementType.CREDIT_APPLICATION_REVERSAL,
            direction: 'CREDIT',
            amount: application.remainingAmount,
            debtDelta: new Prisma.Decimal(0),
            creditDelta: application.remainingAmount,
            description: `Reversion de credito aplicado por cancelacion del pedido ${id.slice(0, 8)}`,
            idempotencyKey: `credit-application:${application.id}:cancel-reversal`,
            metadata: auditJson({ source: 'admin_cancel', applicationId: application.id }),
          });
        }
        const finalPaymentStatus = await orderPaymentStatus(tx, id, existing.total);
        updated = await tx.order.update({ where: { id }, data: { paymentStatus: finalPaymentStatus }, include: orderInclude });
      } else if (!totalAdjustmentDebtDelta.equals(0) || !totalAdjustmentCreditDelta.equals(0)) {
        const isDebit = totalAdjustmentDebtDelta.greaterThan(0) || (totalAdjustmentDebtDelta.equals(0) && totalAdjustmentCreditDelta.lessThan(0));
        const movementAmount = Prisma.Decimal.max(totalAdjustmentDebtDelta.abs(), totalAdjustmentCreditDelta.abs());
        await createLedgerMovement(tx, {
          customerId: existing.customerId,
          orderId: id,
          actorId: req.user!.id,
          type: isDebit ? CustomerAccountMovementType.MANUAL_DEBIT_ADJUSTMENT : CustomerAccountMovementType.MANUAL_CREDIT_ADJUSTMENT,
          direction: isDebit ? 'DEBIT' : 'CREDIT',
          amount: movementAmount,
          debtDelta: totalAdjustmentDebtDelta,
          creditDelta: totalAdjustmentCreditDelta,
          description: `Ajuste de cuenta por edicion del pedido ${id.slice(0, 8)}`,
          idempotencyKey: totalAdjustmentMovementKey(id, totalAdjustmentKey),
          metadata: auditJson({ source: 'admin_order_edit', previousTotal: existing.total, nextTotal: updated.total, requestKey: totalAdjustmentKey }),
        });
      }

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

    if (data.status && previousStatus && data.status !== previousStatus) {
      await sendOrderStatusEmail({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerEmail: order.customerEmail,
        customerFirstName: order.customerFirstName,
        status: order.status,
        previousStatus,
        total: order.total,
      });
    }

    res.json({ order: mapOrder(order) });
  } catch (error) {
    if (isUniqueConstraintError(error) && data.idempotencyKey) {
      const movement = await prisma.customerAccountMovement.findUnique({ where: { idempotencyKey: totalAdjustmentMovementKey(id, data.idempotencyKey) } });
      const metadata = movement?.metadata as { requestKey?: string } | null;
      if (movement && metadata?.requestKey === data.idempotencyKey) {
        const existingOrder = await prisma.order.findUnique({ where: { id }, include: orderInclude });
        if (existingOrder) {
          res.json({ order: mapOrder(existingOrder) });
          return;
        }
      }
      next(new AppError(409, 'Idempotency key was already used for another total adjustment', 'IDEMPOTENCY_KEY_CONFLICT'));
      return;
    }
    next(error);
  }
});

adminOrdersRouter.post('/orders/:id/payments', async (req, res, next) => {
  let id = '';
  let data = {} as z.infer<typeof paymentSchema>;
  try {
    id = z.string().uuid().parse(req.params.id);
    data = paymentSchema.parse(req.body);

    const order = await runAccountingTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.order.findUnique({ where: { id } });

      if (!existing) {
        throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
      }

      const existingPayment = await tx.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existingPayment) {
        if (existingPayment.orderId !== id || !existingPayment.amount.equals(data.amount) || existingPayment.method !== data.method || existingPayment.notes !== (data.notes ?? null)) {
          throw new AppError(409, 'Idempotency key was already used with a different payment', 'IDEMPOTENCY_KEY_CONFLICT');
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
      }

       assertOrderIsMutable(existing.status);
       if (existing.status === 'PENDING') {
         throw new AppError(409, 'Payments require an approved order', 'ORDER_NOT_APPROVED');
       }


      const currentPayments = await tx.payment.aggregate({ where: { orderId: id, status: { not: 'REFUNDED' } }, _sum: { appliedAmount: true }, _count: true });
      const currentApplications = await tx.creditApplication.aggregate({ where: { destinationOrderId: id, reversedAt: null }, _sum: { remainingAmount: true }, _count: true });
      const currentApplied = currentPayments._sum.appliedAmount ?? new Prisma.Decimal(0);
      const currentAppliedCredit = currentApplications._sum.remainingAmount ?? new Prisma.Decimal(0);
      const outstandingDebt = existing.total.sub(currentApplied).sub(currentAppliedCredit);
      const { appliedAmount, creditAmount } = splitPayment(new Prisma.Decimal(data.amount), outstandingDebt);
      const nextStatus = calculatePaymentStatus(
        existing.total,
        currentApplied.add(appliedAmount),
        currentAppliedCredit,
        true,
      );
      const payment = await tx.payment.create({
        data: {
          orderId: id,
          registeredById: req.user!.id,
          amount: data.amount,
          idempotencyKey: data.idempotencyKey,
          appliedAmount,
          creditAmount,
          status: nextStatus,
          method: data.method,
          notes: data.notes,
          paidAt: new Date(),
        },
      });

      await createLedgerMovement(tx, {
        customerId: existing.customerId,
        orderId: id,
        paymentId: payment.id,
        actorId: req.user!.id,
        type: CustomerAccountMovementType.PAYMENT_CREDIT,
        direction: 'CREDIT',
        amount: data.amount,
        debtDelta: appliedAmount.mul(-1),
        creditDelta: creditAmount,
        description: `Pago registrado para pedido ${id.slice(0, 8)}`,
        idempotencyKey: `payment:${payment.id}:credit`,
        metadata: auditJson({ source: 'admin_payment', method: data.method }),
        occurredAt: payment.paidAt ?? payment.createdAt,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'Payment',
          entityId: payment.id,
          action: 'CREATE',
          before: Prisma.JsonNull,
          after: auditJson(payment),
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
    if (isUniqueConstraintError(error)) {
      const existingPayment = await prisma.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existingPayment && existingPayment.orderId === id && existingPayment.amount.equals(data.amount) && existingPayment.method === data.method && existingPayment.notes === (data.notes ?? null)) {
        const existingOrder = await prisma.order.findUnique({ where: { id }, include: orderInclude });
        if (existingOrder) {
          res.status(201).json({ order: mapOrder(existingOrder) });
          return;
        }
      }
      next(new AppError(409, 'Idempotency key was already used with a different payment', 'IDEMPOTENCY_KEY_CONFLICT'));
      return;
    }
    next(error);
  }
});

adminOrdersRouter.post('/orders/:id/payments/:paymentId/reverse', async (req, res, next) => {
  try {
    const orderId = z.string().uuid().parse(req.params.id);
    const paymentId = z.string().uuid().parse(req.params.paymentId);
    const data = paymentReversalSchema.parse(req.body);

    const order = await runAccountingTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      const payment = await tx.payment.findFirst({ where: { id: paymentId, orderId } });

      if (!payment) {
        throw new AppError(404, 'Payment not found', 'PAYMENT_NOT_FOUND');
      }

      if (payment.status === 'REFUNDED' || payment.reversedAt) {
        throw new AppError(409, 'Payment has already been reversed', 'PAYMENT_ALREADY_REVERSED');
      }

      const existingOrder = await tx.order.findUnique({ where: { id: orderId } });
       if (!existingOrder) {
         throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
       }

       if (existingOrder.status === 'CANCELLED') {
         throw new AppError(409, 'Payments from cancelled orders cannot be reversed', 'PAYMENT_REVERSAL_ORDER_CANCELLED');
       }

       const reversedAt = new Date();
      const activeAllocations = await tx.paymentCreditAllocation.findMany({
        where: { paymentId, reversedAt: null },
        include: { creditApplication: true },
      });
      const allocatedCredit = activeAllocations.reduce((sum, allocation) => sum.add(allocation.amount), new Prisma.Decimal(0));
       const reversalEffect = calculatePaymentReversalEffect(payment.appliedAmount, payment.creditAmount, allocatedCredit, false);
      const reversedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'REFUNDED', reversedAt, reversedById: req.user!.id, reversalReason: data.reason },
      });

      await createLedgerMovement(tx, {
        customerId: existingOrder.customerId,
        orderId,
        paymentId,
        actorId: req.user!.id,
        type: CustomerAccountMovementType.PAYMENT_REFUND_DEBIT,
        direction: 'DEBIT',
        amount: payment.amount,
        debtDelta: reversalEffect.debtToRestore,
        creditDelta: reversalEffect.creditToRemove.mul(-1),
        description: `Reverso del pago ${paymentId.slice(0, 8)} del pedido ${formatOrderNumber(existingOrder.orderNumber)}`,
        idempotencyKey: `payment:${paymentId}:refund`,
        metadata: auditJson({ source: 'admin_payment_reversal', reason: data.reason }),
        occurredAt: reversedAt,
      });

      const affectedDestinationOrders = new Set<string>();
      for (const allocation of activeAllocations) {
        const remainingAmount = allocation.creditApplication.remainingAmount.sub(allocation.amount);
        await tx.creditApplication.update({
          where: { id: allocation.creditApplicationId },
          data: {
            remainingAmount,
            reversedAt: remainingAmount.equals(0) ? reversedAt : null,
            reversedById: remainingAmount.equals(0) ? req.user!.id : null,
            reversalReason: remainingAmount.equals(0) ? `Pago ${paymentId} reversado` : null,
          },
        });
        await tx.paymentCreditAllocation.update({
          where: { id: allocation.id },
          data: { reversedAt, reversedById: req.user!.id, reversalReason: data.reason },
        });
        await createLedgerMovement(tx, {
          customerId: existingOrder.customerId,
          orderId: allocation.creditApplication.destinationOrderId,
          paymentId,
          actorId: req.user!.id,
          type: CustomerAccountMovementType.PAYMENT_REFUND_DEBIT,
          direction: 'DEBIT',
          amount: allocation.amount,
          debtDelta: allocation.amount,
          creditDelta: 0,
          description: `Restauracion de deuda por credito aplicado del pago ${paymentId.slice(0, 8)}`,
          idempotencyKey: `payment:${paymentId}:refund:allocation:${allocation.id}`,
          metadata: auditJson({ source: 'admin_payment_reversal', allocationId: allocation.id, reason: data.reason }),
          occurredAt: reversedAt,
        });
        affectedDestinationOrders.add(allocation.creditApplication.destinationOrderId);
      }
      for (const destinationOrderId of affectedDestinationOrders) {
        const destination = await tx.order.findUniqueOrThrow({ where: { id: destinationOrderId }, select: { total: true } });
        const paymentStatus = await orderPaymentStatus(tx, destinationOrderId, destination.total);
        await tx.order.update({ where: { id: destinationOrderId }, data: { paymentStatus } });
      }

      const nextPaymentStatus = await orderPaymentStatus(tx, orderId, existingOrder.total);
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { paymentStatus: nextPaymentStatus }, include: orderInclude });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'Payment',
          entityId: paymentId,
          action: 'REVERSE',
          before: auditJson(payment),
          after: auditJson({ payment: reversedPayment, orderPaymentStatus: nextPaymentStatus, reason: data.reason }),
        },
      });

      return updatedOrder;
    });

    res.json({ order: mapOrder(order) });
  } catch (error) {
    next(error);
  }
});

adminOrdersRouter.post('/orders/:id/payment-receipt-email', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });

    if (!order) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    if (order.payments.length === 0) {
      throw new AppError(409, 'Payment receipt requires at least one registered payment', 'NO_PAYMENTS_FOR_RECEIPT');
    }

    const result = await sendPaymentReceiptEmail({ ...order, orderId: order.id, orderNumber: order.orderNumber }, req.user!.id);
    res.json({ notification: result });
  } catch (error) {
    next(error);
  }
});
