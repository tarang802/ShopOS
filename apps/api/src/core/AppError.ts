import { ERROR_CODES, type ApiErrorDetail, type ErrorCode } from '@shopos/shared';

/**
 * The one error type services throw.
 *
 * WHAT: an error that already knows its HTTP status and its machine-readable
 * code, so the error handler never has to guess.
 *
 * WHY: without this, every controller ends up writing its own try/catch and its
 * own res.status(...).json(...), and the API's error shape slowly diverges. With
 * it, a service simply throws and the centralized handler renders the response.
 *
 * `isOperational` marks errors we *expected* (bad input, missing record, no
 * permission). Anything else - a null dereference, a driver failure - is a bug,
 * and is logged at error level with its stack while the client is told only
 * "something went wrong". Internal details must never leak to a client.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: ApiErrorDetail[];
  public readonly isOperational = true;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: ApiErrorDetail[]): AppError {
    return new AppError(400, ERROR_CODES.BAD_REQUEST, message, details);
  }

  static validation(message = 'Validation failed', details?: ApiErrorDetail[]): AppError {
    return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static permissionDenied(permission: string): AppError {
    return new AppError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      `This action requires the "${permission}" permission`,
    );
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(404, ERROR_CODES.NOT_FOUND, `${resource} not found`);
  }

  static conflict(message: string): AppError {
    return new AppError(409, ERROR_CODES.CONFLICT, message);
  }

  static duplicate(message: string): AppError {
    return new AppError(409, ERROR_CODES.DUPLICATE_RESOURCE, message);
  }

  /** The request was valid but the business will not allow it. */
  static businessRule(message: string, code: ErrorCode = ERROR_CODES.BUSINESS_RULE_VIOLATION) {
    return new AppError(422, code, message);
  }

  static internal(message = 'Something went wrong'): AppError {
    return new AppError(500, ERROR_CODES.INTERNAL_ERROR, message);
  }
}
