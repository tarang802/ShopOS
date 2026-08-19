import pino from 'pino';
import { env, isProduction } from '../config/env';

/**
 * Structured logging.
 *
 * In production we emit JSON, because log aggregators parse JSON and not prose.
 * In development we pretty-print, because humans do not parse JSON.
 *
 * `redact` is a security control, not a formatting choice: it guarantees that a
 * password or token can never reach a log file even if someone logs a whole
 * request body by mistake.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
