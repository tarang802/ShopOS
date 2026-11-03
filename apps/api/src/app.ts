import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env';
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
 *   4b. cookies      - the refresh token lives in an httpOnly cookie
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

  /**
   * CORS.
   *
   * In production the allow-list is absolute: an origin either appears in
   * CORS_ORIGINS or it is refused.
   *
   * In development any localhost port is accepted. Vite moves to another port
   * whenever the configured one is busy, and having the API reject the dev
   * server for that reason wastes far more time than the relaxation risks - a
   * page served from localhost is already the developer's own machine.
   */
  const isLocalhostOrigin = (origin: string) =>
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  /**
   * A browser attaches an Origin header to every same-site POST, PUT, PATCH and
   * DELETE, not only to cross-site ones. When this API also serves the web app (one
   * address for both, as in a single-container deployment) every save would
   * otherwise be refused unless the operator remembered to list the app's own URL.
   * So a request whose Origin is this server's own address is always allowed; any
   * other site still has to be on the list.
   */
  const isOwnOrigin = (origin: string, host: string | undefined, protocol: string) =>
    host !== undefined && origin === `${protocol}://${host}`;

  app.use(
    cors((req, callback) => {
      const origin = req.header('Origin');

      // Requests without an Origin header are server-to-server or curl, not a
      // browser, so the same-origin policy does not apply to them.
      const allowed =
        !origin ||
        isOwnOrigin(origin, req.get('host'), req.protocol) ||
        env.CORS_ORIGINS.includes(origin) ||
        (!isProduction && isLocalhostOrigin(origin));

      if (!allowed) {
        callback(AppError.forbidden(`Origin ${origin} is not allowed`));
        return;
      }
      callback(null, { origin: true, credentials: true });
    }),
  );

  app.use(compression());
  // The refresh token travels in an httpOnly cookie, so cookies must be parsed
  // before any route that reads it.
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  app.use(requestLogger);
  app.use(generalLimiter);

  app.use(API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
