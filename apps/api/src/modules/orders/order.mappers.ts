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
  creditApplications: {
    orderBy: { appliedAt: 'desc' },
  },
});

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function formatOrderNumber(orderNumber: number) {
  const padded = String(orderNumber).padStart(6, '0');
  return `${padded.slice(0, 3)}-${padded.slice(3)}`;
}

function decimalToNumber(value: { toNumber(): number }) {
  return value.toNumber();
}

export function mapOrder(order: OrderWithRelations) {
  const appliedPayments = order.payments
    .filter((payment) => payment.status !== 'REFUNDED')
    .reduce((total, payment) => total.add(payment.appliedAmount), new Prisma.Decimal(0));
  const appliedCredit = order.creditApplications
    .filter((application) => !application.reversedAt)
    .reduce((total, application) => total.add(application.remainingAmount), new Prisma.Decimal(0));
  const outstandingDebt = order.status === 'CANCELLED'
    ? new Prisma.Decimal(0)
    : Prisma.Decimal.max(order.total.sub(appliedPayments).sub(appliedCredit), new Prisma.Decimal(0));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
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
    outstandingDebt: decimalToNumber(outstandingDebt),
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
      appliedAmount: decimalToNumber(payment.appliedAmount),
      creditAmount: decimalToNumber(payment.creditAmount),
      status: payment.status,
      method: payment.method,
      notes: payment.notes,
      paidAt: payment.paidAt,
      reversedAt: payment.reversedAt,
      reversedById: payment.reversedById,
      reversalReason: payment.reversalReason,
      createdAt: payment.createdAt,
    })),
    creditApplications: order.creditApplications.map((application) => ({
      id: application.id,
      amount: decimalToNumber(application.amount),
      remainingAmount: decimalToNumber(application.remainingAmount),
      appliedById: application.appliedById,
      appliedAt: application.appliedAt,
      description: application.description,
      reversedAt: application.reversedAt,
      reversalReason: application.reversalReason,
    })),
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
