import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env, isProduction } from '../config/env';
import { AppError } from '../core/AppError';
import { ERROR_CODES } from '@shopos/shared';

/**
 * Token strategy.
 *
 * TWO tokens, with different jobs:
 *
 * - The ACCESS token is a short-lived JWT (15 minutes) sent on every request.
 *   It is self-contained, so verifying it needs no database round trip. It
 *   cannot be withdrawn once issued, which is exactly why it is short-lived.
 *
 * - The REFRESH token is a long-lived random string held in an httpOnly cookie.
 *   It is the thing with real power - it mints new access tokens for weeks - so
 *   it never touches JavaScript, only a hash of it is stored, and it is rotated
 *   on every use.
 *
 * WHY the access token carries almost nothing: only ids. Permissions are
 * resolved from the database on each request, so removing someone's rights takes
 * effect on their very next call rather than whenever their token happens to
 * expire. Baking permissions into a token trades a database read for a window in
 * which a dismissed employee still has access.
 */

export const REFRESH_COOKIE_NAME = 'shopos_rt';

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Organization the session is working in. */
  org: string;
  /** Membership id, so permissions can be resolved in one lookup. */
  mid: string;
  /** Session id, so a revoked session invalidates its access tokens on refresh. */
  sid: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'shopos',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'shopos' }) as AccessTokenPayload;
  } catch (error) {
    // The client needs to tell "expired, go refresh" apart from "invalid, go log
    // in again", so these are separate codes rather than one generic 401.
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired');
    }
    throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Invalid authentication token');
  }
}

/** A fresh refresh token. 64 random bytes is far beyond guessable. */
export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex');
}

/**
 * Only the hash is ever stored.
 *
 * A stolen database dump therefore contains no usable tokens - the same
 * reasoning as never storing a password. SHA-256 is right here (unlike for
 * passwords, which need a slow hash): the token is already 64 random bytes, so
 * there is no low-entropy guess for an attacker to brute-force.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Put the refresh token in an httpOnly cookie.
 *
 * WHY a cookie rather than the response body: a token in localStorage can be
 * read by any script that manages to run on the page, so one XSS becomes a
 * permanent account takeover. An httpOnly cookie is invisible to JavaScript
 * entirely. `sameSite: lax` keeps it from being sent on cross-site requests,
 * which is what would otherwise make it usable for CSRF.
 */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    expires: refreshTokenExpiry(),
    path: '/api/v1/auth',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function toObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
