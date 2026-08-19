import type { Response } from 'express';
import { buildPaginationMeta, type ApiPaginated, type ApiSuccess } from '@shopos/shared';

/**
 * Response helpers.
 *
 * Controllers call these instead of res.json(...) directly, so the envelope
 * described in the API contract is produced in exactly one place.
 */

export function sendSuccess<TData>(
  res: Response,
  data: TData,
  message?: string,
  statusCode = 200,
): void {
  const body: ApiSuccess<TData> = { success: true, data };
  if (message) body.message = message;
  res.status(statusCode).json(body);
}

export function sendCreated<TData>(res: Response, data: TData, message?: string): void {
  sendSuccess(res, data, message, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}

export function sendPaginated<TItem>(
  res: Response,
  items: TItem[],
  params: { page: number; limit: number; total: number },
  message?: string,
): void {
  const body: ApiPaginated<TItem> = {
    success: true,
    data: items,
    pagination: buildPaginationMeta(params.page, params.limit, params.total),
  };
  if (message) body.message = message;
  res.status(200).json(body);
}
