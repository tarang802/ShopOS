import type { Request, Response } from 'express';
import { getConnectionState, getDatabaseCapabilities } from '../../config/database';
import { sendSuccess } from '../../core/http';
import { APP_NAME, APP_VERSION } from '../../core/constants';
import { env } from '../../config/env';

/**
 * Health endpoints.
 *
 * `live` answers "is this process running?" and is what a container orchestrator
 * restarts on. `ready` answers "can this process serve traffic?" - it fails when
 * the database is unreachable, so a load balancer stops sending requests to an
 * instance that would only return errors.
 */

export function live(_req: Request, res: Response): void {
  sendSuccess(res, { status: 'ok' });
}

export function ready(_req: Request, res: Response): void {
  const database = getConnectionState();
  const isReady = database === 'connected';

  res.status(isReady ? 200 : 503).json({
    success: isReady,
    ...(isReady
      ? { data: { status: 'ready', database } }
      : { error: { code: 'SERVICE_UNAVAILABLE', message: `Database is ${database}` } }),
  });
}

export function status(_req: Request, res: Response): void {
  const capabilities = getDatabaseCapabilities();

  sendSuccess(res, {
    name: APP_NAME,
    version: APP_VERSION,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      state: getConnectionState(),
      topology: capabilities.topology,
      supportsTransactions: capabilities.supportsTransactions,
    },
  });
}
