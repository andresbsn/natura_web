import type { OrderStatus, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';

type OrderStatusEmailData = {
  orderId: string;
  customerId: string;
  customerEmail: string;
  customerFirstName: string;
  status: OrderStatus;
  previousStatus: OrderStatus;
  total: { toNumber(): number };
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

export async function sendOrderStatusEmail(order: OrderStatusEmailData) {
  const subject = `Actualizacion de tu pedido ${order.orderId.slice(0, 8)}`;
  const statusLabel = statusLabels[order.status];
  const text = [
    `Hola ${order.customerFirstName},`,
    '',
    statusMessages[order.status],
    '',
    `Pedido: ${order.orderId}`,
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
