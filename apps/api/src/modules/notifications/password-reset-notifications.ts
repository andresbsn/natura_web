import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';

export async function sendPasswordResetEmail(data: { userId: string; email: string; firstName: string; token: string }) {
  const subject = 'Recuperacion de contraseña';
  const url = `${env.WEB_URL.replace(/\/$/, '')}/restablecer-contrasena?token=${encodeURIComponent(data.token)}`;
  const text = [`Hola ${data.firstName},`, '', 'Usa este enlace para restablecer tu contraseña (vence en 30 minutos):', url, '', 'Si no lo solicitaste, ignora este email.'].join('\n');
  const configured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
  let sent = false;
  let reason = configured ? undefined : 'SMTP_NOT_CONFIGURED';
  try {
    if (configured) {
      const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
      await transporter.sendMail({ from: env.SMTP_FROM, to: data.email, subject, text });
      sent = true;
    }
  } catch { reason = 'SMTP_SEND_FAILED'; }
  await prisma.notification.create({ data: { userId: data.userId, channel: 'EMAIL', subject, payload: { event: 'PASSWORD_RESET_REQUESTED', recipient: data.email, sent, ...(reason ? { reason } : {}) }, ...(sent ? { sentAt: new Date() } : {}) } }).catch(() => undefined);
}
