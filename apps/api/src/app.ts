import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './config/env';
import { API_PREFIX, JSON_BODY_LIMIT } from './core/constants';
import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { generalLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import { AppError } from './core/AppError';

/**
 * The Express application.
 *
 * Middleware order is deliberate and is itself a security control:
 *   1. helmet        - security headers before anything can respond
 *   2. cors          - reject foreign origins before doing any work
 *   3. compression   - shrink responses
 *   4. body parsing  - with a size limit, so a huge payload is refused early
 *   5. logging       - every request gets a correlation id
 *   6. rate limiting - throttle before touching the database
 *   7. routes
 *   8. 404 then the error handler, which must be registered last
 *
 * The app is exported separately from the server so tests can drive it without
 * opening a port or connecting to a real database.
 */
export function createApp(): Express {
  const app = express();

  // Required when running behind a reverse proxy (nginx, Render, Railway) so
  // rate limiting sees the client's real IP rather than the proxy's.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header are server-to-server or curl, not a
        // browser, so the same-origin policy does not apply to them.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(AppError.forbidden(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  app.use(requestLogger);
  app.use(generalLimiter);

  app.use(API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
