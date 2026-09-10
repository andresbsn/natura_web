import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { adminAccountsRouter } from './modules/admin/admin.accounts.routes.js';
import { adminOrdersRouter } from './modules/admin/admin.orders.routes.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminProductsRouter } from './modules/admin/admin.products.routes.js';
import { adminPromotionsRouter } from './modules/admin/admin.promotions.routes.js';
import { adminCatalogsRouter } from './modules/admin/admin.catalogs.routes.js';
import { adminUsersRouter } from './modules/admin/admin.users.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';

export function createApp() {
  const app = express();
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
  app.use(cookieParser());
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/account', accountsRouter);
  app.use('/api/admin', adminAccountsRouter);
  app.use('/api/admin', adminProductsRouter);
  app.use('/api/admin', adminOrdersRouter);
  app.use('/api/admin', adminPromotionsRouter);
  app.use('/api/admin', adminCatalogsRouter);
  app.use('/api/admin', adminUsersRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/orders', ordersRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
