import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { authLimiter } from '../../middleware/rateLimiter';
import * as controller from './auth.controller';
import {
  googleLoginSchema,
  loginSchema,
  registerSchema,
  switchOrganizationSchema,
} from './auth.schemas';

export const authRouter = Router();

/**
 * The strict limiter is applied to every route that accepts a credential.
 * Login is where password guessing happens, and a generous limit there is an
 * open door - ten attempts per quarter hour is ample for a person who has
 * genuinely forgotten which password they used.
 */
authRouter.get('/capabilities', controller.capabilities);

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post(
  '/google',
  authLimiter,
  validate({ body: googleLoginSchema }),
  controller.googleLogin,
);

// Refresh carries no credential the user typed, so it uses the general limiter.
authRouter.post('/refresh', controller.refresh);
authRouter.post('/logout', controller.logout);

authRouter.get('/me', authenticate, controller.me);
authRouter.get('/organizations', authenticate, controller.myOrganizations);
authRouter.post(
  '/switch-organization',
  authenticate,
  validate({ body: switchOrganizationSchema }),
  controller.switchOrganization,
);
