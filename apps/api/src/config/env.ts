import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('host.docker.internal') && !fs.existsSync('/.dockerenv')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('host.docker.internal', 'localhost');
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(16).default('development_access_secret_change_me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('development_refresh_secret_change_me'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  ORDER_NOTIFICATION_INTERNAL_RECIPIENTS: z.string().optional(),
}).superRefine((data, ctx) => {
  const webUrl = new URL(data.WEB_URL);
  const isLocalWebUrl = webUrl.hostname === 'localhost' || webUrl.hostname === '127.0.0.1';

  if (data.NODE_ENV === 'production' && isLocalWebUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'WEB_URL must be the public frontend URL in production, not localhost.',
      path: ['WEB_URL'],
    });
  }

  if (data.NODE_ENV === 'production') {
    for (const [name, value] of [['JWT_ACCESS_SECRET', data.JWT_ACCESS_SECRET], ['JWT_REFRESH_SECRET', data.JWT_REFRESH_SECRET]] as const) {
      if (value.includes('development_') || value.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be a random secret of at least 32 characters in production.`, path: [name] });
      }
    }

    if (!data.WEB_URL.startsWith('https://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'WEB_URL must use HTTPS in production.', path: ['WEB_URL'] });
    }
  }

  if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JWT access and refresh secrets must be different.', path: ['JWT_REFRESH_SECRET'] });
  }
});

export const env = envSchema.parse(process.env);
