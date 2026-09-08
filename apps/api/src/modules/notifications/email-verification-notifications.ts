import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';

type EmailVerificationData = {
  userId: string;
  email: string;
  firstName: string;
  token: string;
};

function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
}

export async function sendEmailVerificationEmail(data: EmailVerificationData) {
  const verificationUrl = `${env.WEB_URL.replace(/\/$/, '')}/verificar-email?token=${encodeURIComponent(data.token)}`;
  const subject = 'Confirma tu email para completar el registro';
  const text = [
    `Hola ${data.firstName},`,
    '',
    'Para completar tu registro y poder confirmar pedidos, valida tu email ingresando al siguiente enlace:',
    verificationUrl,
    '',
    'El enlace vence en 24 horas. Si no creaste esta cuenta, podes ignorar este mensaje.',
    '',
    'Saludos.',
  ].join('\n');

  if (!isSmtpConfigured()) {
    await prisma.notification.create({
      data: {
        userId: data.userId,
        channel: 'EMAIL',
        subject,
        payload: {
          event: 'EMAIL_VERIFICATION_REQUESTED',
          recipient: data.email,
          sent: false,
          reason: 'SMTP_NOT_CONFIGURED',
        },
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
      to: data.email,
      subject,
      text,
    });

    await prisma.notification.create({
      data: {
        userId: data.userId,
        channel: 'EMAIL',
        subject,
        payload: { event: 'EMAIL_VERIFICATION_REQUESTED', recipient: data.email, sent: true },
        sentAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.notification.create({
      data: {
        userId: data.userId,
        channel: 'EMAIL',
        subject,
        payload: {
          event: 'EMAIL_VERIFICATION_REQUESTED',
          recipient: data.email,
          sent: false,
          reason: 'SMTP_SEND_FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}
