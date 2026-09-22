import type { OrderStatus, Payment, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { formatOrderNumber } from '../orders/order.mappers.js';

type OrderStatusEmailData = {
  orderId: string;
  orderNumber: number;
  customerId: string;
  customerEmail: string;
  customerFirstName: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
  total: { toNumber(): number };
};

type PaymentReceiptEmailData = {
  orderId: string;
  orderNumber: number;
  customerId: string;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  customerPhone: string | null;
  status: OrderStatus;
  paymentStatus: string;
  subtotal: { toNumber(): number };
  deliveryCost: { toNumber(): number };
  total: { toNumber(): number };
  createdAt: Date;
  payments: Array<Pick<Payment, 'id' | 'amount' | 'method' | 'notes' | 'paidAt' | 'createdAt' | 'status'>>;
  items: Array<{
    productNameSnapshot: string;
    variantNameSnapshot: string;
    quantity: number;
    unitPrice: { toNumber(): number };
    lineTotal: { toNumber(): number };
  }>;
};

const statusLabels: Record<OrderStatus, string> = {
  PENDING: 'pendiente',
  CONFIRMED: 'confirmado',
  PREPARING: 'en preparacion',
  DELIVERED: 'entregado',
  CANCELLED: 'cancelado',
};

const statusMessages: Record<OrderStatus, string> = {
  PENDING: 'Recibimos tu pedido y quedo pendiente de revision.',
  CONFIRMED: 'Tu pedido fue aprobado y confirmado. Te avisaremos cuando avance la preparacion.',
  PREPARING: 'Estamos preparando tu pedido.',
  DELIVERED: 'Tu pedido figura como entregado. Gracias por comprar.',
  CANCELLED: 'Tu pedido fue cancelado. Si tenes dudas, responde este email para consultarnos.',
};

const paymentStatusLabels: Record<string, string> = {
  UNPAID: 'sin pago',
  PARTIALLY_PAID: 'pago parcial',
  PAID: 'pagado',
  REFUNDED: 'reembolsado',
};

function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
}

function notificationPayload(order: OrderStatusEmailData, extra: Record<string, unknown>): Prisma.InputJsonValue {
  return {
    event: 'ORDER_STATUS_CHANGED',
    recipient: order.customerEmail,
    previousStatus: order.previousStatus,
    status: order.status,
    ...extra,
  };
}

function paymentReceiptPayload(order: PaymentReceiptEmailData, extra: Record<string, unknown>): Prisma.InputJsonValue {
  return {
    event: 'PAYMENT_RECEIPT_SENT',
    recipient: order.customerEmail,
    paymentStatus: order.paymentStatus,
    paidAmount: paidAmount(order),
    ...extra,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function paidAmount(order: PaymentReceiptEmailData) {
  return order.payments.filter((payment) => payment.status !== 'REFUNDED').reduce((total, payment) => total + payment.amount.toNumber(), 0);
}

export async function sendOrderStatusEmail(order: OrderStatusEmailData) {
  const displayOrderNumber = formatOrderNumber(order.orderNumber);
  const subject = `Actualizacion de tu pedido ${displayOrderNumber}`;
  const statusLabel = statusLabels[order.status];
  const text = [
    `Hola ${order.customerFirstName},`,
    '',
    statusMessages[order.status],
    '',
    `Pedido: ${displayOrderNumber}`,
    `Estado anterior: ${statusLabels[order.previousStatus]}`,
    `Estado actual: ${statusLabel}`,
    `Total: ${formatCurrency(order.total.toNumber())}`,
    '',
    'Saludos.',
  ].join('\n');

  if (!isSmtpConfigured()) {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: notificationPayload(order, { sent: false, reason: 'SMTP_NOT_CONFIGURED' }),
      },
    });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: order.customerEmail,
      subject,
      text,
    });

    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: notificationPayload(order, { sent: true }),
        sentAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: notificationPayload(order, {
          sent: false,
          reason: 'SMTP_SEND_FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
    });
  }
}

export async function sendOrderCreatedEmails(order: { orderId: string; orderNumber: number; customerId: string; customerEmail: string; customerFirstName: string; total: { toNumber(): number } }) {
  const recipients = [order.customerEmail, ...(env.ORDER_NOTIFICATION_INTERNAL_RECIPIENTS ?? '').split(',').map((value) => value.trim()).filter(Boolean)];
  const displayOrderNumber = formatOrderNumber(order.orderNumber);
  const subject = `Nuevo pedido ${displayOrderNumber}`;
  const text = [`Hola ${order.customerFirstName},`, '', 'Recibimos tu pedido y quedó pendiente de revisión.', `Pedido: ${displayOrderNumber}`, `Total: ${formatCurrency(order.total.toNumber())}`].join('\n');
  const configured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
  for (const recipient of recipients) {
    let sent = false; let reason = configured ? undefined : 'SMTP_NOT_CONFIGURED';
    try {
      if (configured) {
        const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
        await transporter.sendMail({ from: env.SMTP_FROM, to: recipient, subject, text }); sent = true;
      }
    } catch { reason = 'SMTP_SEND_FAILED'; }
    await prisma.notification.create({ data: { userId: recipient === order.customerEmail ? order.customerId : null, orderId: order.orderId, channel: 'EMAIL', subject, payload: { event: 'ORDER_CREATED', recipient, sent, ...(reason ? { reason } : {}) }, ...(sent ? { sentAt: new Date() } : {}) } }).catch(() => undefined);
  }
}

export async function sendPaymentReceiptEmail(order: PaymentReceiptEmailData, actorId: string) {
  const displayOrderNumber = formatOrderNumber(order.orderNumber);
  const subject = `Comprobante de pago - pedido ${displayOrderNumber}`;
  const totalPaid = paidAmount(order);
  const balance = Math.max(order.total.toNumber() - totalPaid, 0);
  const paymentLines = order.payments.length > 0
    ? order.payments.map((payment) => `- ${payment.status === 'REFUNDED' ? '[REVERSADO] ' : ''}${formatDate(payment.paidAt ?? payment.createdAt)} · ${payment.method ?? 'Metodo no informado'} · ${formatCurrency(payment.amount.toNumber())}`)
    : ['- Sin pagos registrados.'];
  const itemLines = order.items.map((item) => `- ${item.quantity} x ${item.productNameSnapshot} (${item.variantNameSnapshot}) · ${formatCurrency(item.lineTotal.toNumber())}`);
  const text = [
    `Hola ${order.customerFirstName},`,
    '',
    'Te enviamos el comprobante de pago registrado para tu pedido. Este comprobante corresponde a una compra coordinada con una revendedora independiente y no es una factura fiscal.',
    '',
    `Pedido: ${displayOrderNumber}`,
    `Fecha del pedido: ${formatDate(order.createdAt)}`,
    `Cliente: ${order.customerFirstName} ${order.customerLastName}`,
    `Estado del pedido: ${statusLabels[order.status]}`,
    `Estado de pago: ${paymentStatusLabels[order.paymentStatus] ?? order.paymentStatus}`,
    '',
    'Productos:',
    ...itemLines,
    '',
    `Subtotal: ${formatCurrency(order.subtotal.toNumber())}`,
    `Entrega: ${formatCurrency(order.deliveryCost.toNumber())}`,
    `Total: ${formatCurrency(order.total.toNumber())}`,
    `Pagado: ${formatCurrency(totalPaid)}`,
    `Saldo pendiente: ${formatCurrency(balance)}`,
    '',
    'Pagos registrados:',
    ...paymentLines,
    '',
    'Saludos.',
  ].join('\n');

  if (!isSmtpConfigured()) {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: paymentReceiptPayload(order, { sent: false, reason: 'SMTP_NOT_CONFIGURED', actorId }),
      },
    });
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });

    await transporter.sendMail({ from: env.SMTP_FROM, to: order.customerEmail, subject, text });
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: paymentReceiptPayload(order, { sent: true, actorId }),
        sentAt: new Date(),
      },
    });
    return { sent: true };
  } catch (error) {
    await prisma.notification.create({
      data: {
        userId: order.customerId,
        orderId: order.orderId,
        channel: 'EMAIL',
        subject,
        payload: paymentReceiptPayload(order, {
          sent: false,
          reason: 'SMTP_SEND_FAILED',
          actorId,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      },
    });
    return { sent: false, reason: 'SMTP_SEND_FAILED' };
  }
}
