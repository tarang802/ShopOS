import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Permission } from '@shopos/shared';
import { AppError } from '../core/AppError';

/**
 * Permission-based authorization.
 *
 * WHY not `if (role === 'OWNER')`: because what a manager is allowed to do
 * differs between businesses, and hard-coding role names means every such
 * difference needs a code change. Permissions are data; roles are bundles of
 * them; code only ever asks about permissions.
 *
 * This runs on the server, after `authenticate`. The web app performs the same
 * checks purely to hide buttons - that is a courtesy to the user, not a security
 * control, and it is assumed to be bypassed.
 */

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) {
      next(AppError.unauthenticated('Please sign in to continue'));
      return;
    }

    // Several permissions listed together mean "all of these", not "any".
    // Requiring the stronger reading keeps a partial grant from passing a check
    // it was never meant to satisfy.
    const missing = permissions.find((permission) => !ctx.permissions.has(permission));
    if (missing) {
      next(AppError.permissionDenied(missing));
      return;
    }

    next();
  };
}

/**
 * Pass when the caller holds at least one of the listed permissions.
 *
 * Used where two roles legitimately reach the same screen by different routes -
 * for example a stock list, visible both to someone who manages inventory and to
 * someone who only sells from it.
 */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) {
      next(AppError.unauthenticated('Please sign in to continue'));
      return;
    }

    const granted = permissions.some((permission) => ctx.permissions.has(permission));
    if (!granted) {
      next(AppError.permissionDenied(permissions.join(' or ')));
      return;
    }

    next();
  };
}
