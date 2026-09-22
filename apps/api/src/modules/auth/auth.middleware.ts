import type { NextFunction, Request, Response } from 'express';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { verifyAccessToken } from './auth.tokens.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    return next(new AppError(401, 'Authentication required', 'AUTH_REQUIRED'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(new AppError(401, 'Invalid or expired token', 'INVALID_TOKEN'));
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required', 'AUTH_REQUIRED'));
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, isActive: true } });

      if (!user || !user.isActive) {
        return next(new AppError(401, 'Invalid session', 'INVALID_SESSION'));
      }

      req.user.role = user.role;
      if (!roles.includes(user.role)) {
        return next(new AppError(403, 'Insufficient permissions', 'FORBIDDEN'));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export async function requireVerifiedActiveUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, 'Authentication required', 'AUTH_REQUIRED'));
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, isActive: true, emailVerifiedAt: true },
    });

    if (!user || !user.isActive) {
      return next(new AppError(404, 'User not found', 'USER_NOT_FOUND'));
    }

    if (!user.emailVerifiedAt) {
      return next(new AppError(403, 'Email verification required', 'EMAIL_VERIFICATION_REQUIRED'));
    }

    return next();
  } catch (error) {
    return next(error);
  }
}
