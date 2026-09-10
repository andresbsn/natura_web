import { Prisma } from '@prisma/client';

export const orderInclude = Prisma.validator<Prisma.OrderInclude>()({
  customer: true,
  deliveryMethod: true,
  items: {
    orderBy: { createdAt: 'asc' },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
  },
});

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function decimalToNumber(value: { toNumber(): number }) {
  return value.toNumber();
}

export function mapOrder(order: OrderWithRelations) {
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customer: {
      id: order.customer.id,
      email: order.customerEmail,
      firstName: order.customerFirstName,
      lastName: order.customerLastName,
      phone: order.customerPhone,
    },
    deliveryMethod: order.deliveryMethod
      ? {
          id: order.deliveryMethod.id,
          name: order.deliveryMethod.name,
          cost: decimalToNumber(order.deliveryMethod.cost),
        }
      : null,
    deliveryAddress: order.deliveryAddress,
    deliveryNotes: order.deliveryNotes,
    subtotal: decimalToNumber(order.subtotal),
    discountTotal: decimalToNumber(order.discountTotal),
    deliveryCost: decimalToNumber(order.deliveryCost),
    total: decimalToNumber(order.total),
    items: order.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productName: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      sku: item.skuSnapshot,
      unitPrice: decimalToNumber(item.unitPrice),
      discountAmount: decimalToNumber(item.discountAmount),
      quantity: item.quantity,
      lineTotal: decimalToNumber(item.lineTotal),
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      amount: decimalToNumber(payment.amount),
      status: payment.status,
      method: payment.method,
      notes: payment.notes,
      paidAt: payment.paidAt,
      reversedAt: payment.reversedAt,
      reversedById: payment.reversedById,
      reversalReason: payment.reversalReason,
      createdAt: payment.createdAt,
    })),
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
