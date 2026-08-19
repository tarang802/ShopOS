import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@shopos/shared';
import { AppError } from '../core/AppError';

/** Unmatched routes become a normal AppError so the envelope stays consistent. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      404,
      ERROR_CODES.NOT_FOUND,
      `Route ${req.method} ${req.originalUrl} does not exist`,
    ),
  );
}
