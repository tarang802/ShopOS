import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { runMigrations } from './db/migrations';
import { logger } from './core/logger';
import { API_PREFIX, APP_NAME, APP_VERSION } from './core/constants';

/**
 * Process lifecycle.
 *
 * The database is connected before the port is opened, so the server never
 * accepts a request it cannot serve. On shutdown the order reverses: stop
 * accepting connections, let in-flight requests finish, then close the database.
 * Killing the database first would fail requests that were nearly done.
 */

let server: Server | undefined;

async function start(): Promise<void> {
  await connectDatabase();
  await runMigrations();

  const app = createApp();

  server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `${APP_NAME} v${APP_VERSION} listening on http://localhost:${env.PORT}${API_PREFIX}`,
    );
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

// An unhandled rejection or uncaught exception means the process is in an
// unknown state. We log it with full detail and exit rather than continuing to
// serve requests from a process we no longer understand.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

start().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
