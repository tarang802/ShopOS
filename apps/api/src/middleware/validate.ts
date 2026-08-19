import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import type { ApiErrorDetail } from '@shopos/shared';
import { AppError } from '../core/AppError';

/**
 * Input validation.
 *
 * WHAT: parses body / query / params against Zod schemas before a controller
 * ever runs, and puts the parsed result on req.validated.
 *
 * WHY: two reasons, and the second matters more.
 *   1. Bad input is rejected once, in one place, with a consistent error shape.
 *   2. Zod schemas are allow-lists. Only declared fields survive parsing, so a
 *      client cannot smuggle organizationId, role or isActive into an update by
 *      adding it to the JSON. This is the defence against mass assignment.
 *
 * Frontend validation exists for a pleasant form experience. This is the
 * validation that actually protects the database.
 */
export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const validated: NonNullable<Request['validated']> = {};

    try {
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        next(AppError.validation('The submitted data is not valid', toDetails(error)));
        return;
      }
      next(error);
      return;
    }

    req.validated = validated;
    next();
  };
}

/**
 * Typed accessors for validated data.
 *
 * The cast is confined to these three functions rather than sprayed through
 * controllers, and it is only reached on routes that ran validate() first.
 */
export function body<T>(req: Request): T {
  return req.validated?.body as T;
}

export function query<T>(req: Request): T {
  return req.validated?.query as T;
}

export function params<T>(req: Request): T {
  return req.validated?.params as T;
}
