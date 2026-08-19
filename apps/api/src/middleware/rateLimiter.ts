import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@shopos/shared';
import { isTest } from '../config/env';

/**
 * Rate limiting.
 *
 * The general limiter protects the API from runaway clients. The auth limiter is
 * much stricter because login is where password guessing happens - a wide limit
 * there is an open door.
 *
 * Note: this is per-process, in-memory. When ShopOS runs on more than one
 * instance it must move to a shared store (Redis), otherwise the effective limit
 * multiplies by the number of instances. Flagged for the deployment phase.
 */
const rateLimitedBody = {
  success: false,
  error: {
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
};

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 100_000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitedBody,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 100_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    ...rateLimitedBody,
    error: {
      ...rateLimitedBody.error,
      message: 'Too many attempts. Please wait a few minutes before trying again.',
    },
  },
});
