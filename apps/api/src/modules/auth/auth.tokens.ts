import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';

const accessTokenTtl = '15m';
const refreshTokenTtl = '7d';

export type AccessTokenPayload = {
  sub: string;
  role: string;
};

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: accessTokenTtl });
}

export function signRefreshToken(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, { expiresIn: refreshTokenTtl });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}
