import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth } from './auth.middleware.js';
import {
  hashToken,
  refreshTokenExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './auth.tokens.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().max(40).optional(),
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

export const authRouter = Router();

function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: import('express').Response) {
  res.clearCookie('refreshToken', { path: '/api/auth' });
}

function publicUser(user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
  };
}

async function createSession(user: { id: string; role: string }) {
  const refreshToken = signRefreshToken(user.id);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken,
  };
}

authRouter.post('/register', authLimiter, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });

    if (existing) {
      throw new AppError(409, 'Email is already registered', 'EMAIL_ALREADY_REGISTERED');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      },
    });
    const session = await createSession(user);

    setRefreshCookie(res, session.refreshToken);
    res.status(201).json({ user: publicUser(user), accessToken: session.accessToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });

    if (!user || !user.isActive || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const session = await createSession(user);
    setRefreshCookie(res, session.refreshToken);
    res.json({ user: publicUser(user), accessToken: session.accessToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken as string | undefined;

    if (!refreshToken) {
      throw new AppError(401, 'Refresh token required', 'REFRESH_REQUIRED');
    }

    const payload = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date() || storedToken.userId !== payload.sub) {
      throw new AppError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    await prisma.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: new Date() } });
    const session = await createSession(storedToken.user);

    setRefreshCookie(res, session.refreshToken);
    res.json({ user: publicUser(storedToken.user), accessToken: session.accessToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken as string | undefined;

    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    clearRefreshCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    if (!user || !user.isActive) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
