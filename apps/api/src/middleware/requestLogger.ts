import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '../core/logger';

/**
 * Request logging with a correlation id.
 *
 * Every request gets an id that appears in each log line it produces and is
 * returned in the X-Request-Id header. When a shop owner reports "it failed at
 * 3pm", that id is how the exact request is found in the logs.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Health checks are polled constantly and would drown out real traffic.
  autoLogging: {
    ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/health/live',
  },
});
