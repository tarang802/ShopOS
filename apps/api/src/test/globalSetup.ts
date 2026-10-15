import mongoose from 'mongoose';

/**
 * Leave nothing behind.
 *
 * The suites register their own businesses in `shopos_test`, so the whole database is
 * dropped once they finish. The guard refuses to drop anything not named for tests:
 * a wrong connection string must never be able to wipe real data.
 */
export default function setup() {
  return async () => {
    const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/shopos_test?replicaSet=rs0';
    const connection = await mongoose.createConnection(uri).asPromise();
    try {
      const name = connection.db?.databaseName ?? '';
      if (/test/i.test(name)) await connection.dropDatabase();
    } finally {
      await connection.close();
    }
  };
}
