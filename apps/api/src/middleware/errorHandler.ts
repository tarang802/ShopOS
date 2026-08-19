import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError, mongo } from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiError, type ApiErrorDetail } from '@shopos/shared';
import { AppError } from '../core/AppError';
import { logger } from '../core/logger';
import { isProduction } from '../config/env';

/**
 * Centralized error handling - the only place in the API that renders a failure.
 *
 * Everything below translates a known failure into the standard error envelope.
 * Anything it does not recognise is treated as a bug: logged in full with its
 * stack, and reported to the client as a bare 500. Stack traces, driver
 * messages and query fragments must never reach a client, because they describe
 * the shape of the database to an attacker.
 */

interface Normalized {
  statusCode: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  /** Expected failures are logged quietly; unexpected ones are logged loudly. */
  isOperational: boolean;
}

function normalize(error: unknown): Normalized {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      isOperational: true,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'The submitted data is not valid',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      isOperational: true,
    };
  }

  if (error instanceof MongooseError.ValidationError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'The submitted data is not valid',
      details: Object.values(error.errors).map((field) => ({
        field: field.path,
        message: field.message,
      })),
      isOperational: true,
    };
  }

  // A malformed id such as /products/not-an-id.
  if (error instanceof MongooseError.CastError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: `Invalid value for "${error.path}"`,
      isOperational: true,
    };
  }

  // Unique index violation. We report which field collided but never the value.
  if (error instanceof mongo.MongoServerError && error.code === 11000) {
    const fields = Object.keys((error.keyPattern as Record<string, unknown>) ?? {})
      .filter((field) => field !== 'organizationId');
    return {
      statusCode: 409,
      code: ERROR_CODES.DUPLICATE_RESOURCE,
      message:
        fields.length > 0
          ? `A record with this ${fields.join(' and ')} already exists`
          : 'A record with these details already exists',
      isOperational: true,
    };
  }

  return {
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Something went wrong',
    isOperational: false,
  };
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const normalized = normalize(error);

  const logPayload = { err: error, requestId: req.id, path: req.originalUrl, method: req.method };
  if (normalized.isOperational) {
    logger.warn(logPayload, normalized.message);
  } else {
    logger.error(logPayload, 'Unhandled error');
  }

  const body: ApiError = {
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  };

  // In development only, attach the real message to unexpected errors so the
  // developer is not left guessing. Production clients get nothing extra.
  if (!isProduction && !normalized.isOperational && error instanceof Error) {
    body.error.details = [{ field: '(debug)', message: error.message }];
  }

  res.status(normalized.statusCode).json(body);
}
