import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@shopos/shared';
import { env, isProduction, isTest } from '../config/env';

/**
 * Rate limiting.
 *
 * The general limiter protects the API from runaway clients. The auth limiter is
 * stricter because login is where password guessing happens.
 *
 * WHY THE LIMIT DIFFERS BY ENVIRONMENT: ten attempts per fifteen minutes is the
 * right number for a live shop, where a person who has forgotten which password
 * they used still has plenty of room. It is the wrong number for development,
 * where you sign in and out constantly, run the smoke test, and lock yourself
 * out within minutes for no security benefit at all. A control that gets in the
 * way during development is a control people eventually delete, so it is tuned
 * per environment instead.
 *
 * Both values can be overridden with AUTH_RATE_LIMIT and GENERAL_RATE_LIMIT if
 * a particular deployment needs something different.
 *
 * Note: this is per-process, in-memory. Restarting the API clears every counter.
 * When ShopOS runs on more than one instance it must move to a shared store
 * (Redis), otherwise the effective limit multiplies by the number of instances.
 * Flagged for the deployment phase.
 */

/** Effectively unlimited, for the automated test environment. */
const NO_LIMIT = 1_000_000;

function authLimit(): number {
  if (isTest) return NO_LIMIT;
  if (env.AUTH_RATE_LIMIT) return env.AUTH_RATE_LIMIT;
  // Strict where it matters, generous where it only causes friction.
  return isProduction ? 10 : 200;
}

function generalLimit(): number {
  if (isTest) return NO_LIMIT;
  if (env.GENERAL_RATE_LIMIT) return env.GENERAL_RATE_LIMIT;
  return isProduction ? 300 : 5_000;
}

const rateLimitedBody = {
  success: false,
  error: {
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
};

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: generalLimit(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitedBody,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: authLimit(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // A successful sign-in does not count. Only failures accumulate, which is what
  // makes this a guessing defence rather than a cap on how often you may log in.
  skipSuccessfulRequests: true,
  message: {
    ...rateLimitedBody,
    error: {
      ...rateLimitedBody.error,
      message: 'Too many attempts. Please wait a few minutes before trying again.',
    },
  },
});
