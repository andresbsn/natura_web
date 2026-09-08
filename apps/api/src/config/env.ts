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
});

export const env = envSchema.parse(process.env);
