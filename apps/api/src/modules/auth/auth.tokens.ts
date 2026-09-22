import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';

const accessTokenTtl = '15m';
const refreshTokenTtl = '7d';
const tokenIssuer = 'natura-api';
const tokenAudience = 'natura-web';

export type AccessTokenPayload = {
  sub: string;
  role: string;
};

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign({ ...payload, token_use: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: accessTokenTtl, issuer: tokenIssuer, audience: tokenAudience });
}

export function signRefreshToken(userId: string) {
  return jwt.sign({ sub: userId, token_use: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: refreshTokenTtl, issuer: tokenIssuer, audience: tokenAudience });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: tokenIssuer, audience: tokenAudience });
  if (typeof payload !== 'object' || payload.token_use !== 'access' || typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
    throw new Error('Invalid access token payload');
  }
  return { sub: payload.sub, role: payload.role } satisfies AccessTokenPayload;
}

export function verifyRefreshToken(token: string) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: tokenIssuer, audience: tokenAudience });
  if (typeof payload !== 'object' || payload.token_use !== 'refresh' || typeof payload.sub !== 'string') {
    throw new Error('Invalid refresh token payload');
  }
  return { sub: payload.sub };
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function refreshTokenExpiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}

export function emailVerificationTokenExpiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

export function passwordResetTokenExpiresAt() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30);
  return date;
}
