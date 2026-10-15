import { defineConfig } from 'vitest/config';

/**
 * API tests.
 *
 * The integration tests drive the real Express app against a real MongoDB, because
 * the properties worth proving here - two terminals selling the last unit, five
 * payments racing one bill, tenant isolation - are properties of the database and
 * the transactions around it, and a mock would only prove the mock.
 *
 * MongoDB must be a replica set, since the code under test uses transactions. Start
 * one with `npm run db:local`. Tests use their own database, `shopos_test`, which the
 * global teardown drops, so they never touch real business data.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      JOBS_ENABLED: 'false',
      MONGODB_URI:
        process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/shopos_test?replicaSet=rs0',
    },
  },
});
