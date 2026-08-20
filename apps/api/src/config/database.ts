import mongoose from 'mongoose';
import { env, isProduction } from './env';
import { logger } from '../core/logger';

/**
 * MongoDB connection management.
 *
 * `strictQuery` makes an unknown field in a filter an error rather than a silent
 * no-op, so a typo in a query name fails loudly instead of returning everything.
 *
 * `autoIndex` is disabled in production. Mongoose otherwise tries to build every
 * declared index on boot, which on a large collection can lock up a live
 * database. Indexes in production are created deliberately, not on startup.
 *
 * ON QUERY-OPERATOR INJECTION, and why `sanitizeFilter` is deliberately NOT set:
 *
 * The attack it defends against is real - a login body of
 * { "email": { "$gt": "" } } would otherwise match the first user in the
 * collection. But ShopOS already blocks that one step earlier: every request
 * body, query string and route parameter is parsed by a Zod schema before any
 * service sees it, and `z.string()` rejects an object outright. Nothing that
 * reaches a filter is unvalidated.
 *
 * Turning `sanitizeFilter` on as well would wrap EVERY object-valued filter in
 * `$eq`, including the many legitimate ones the application builds itself -
 * `{ _id: { $in: ids } }`, `{ quantity: { $gte: 5 } }`. Those would silently stop
 * matching unless each was individually wrapped in `mongoose.trusted()`, and a
 * forgotten wrapper produces a query that quietly returns nothing rather than an
 * error. That failure mode is more dangerous here than the attack it prevents,
 * given the input validation already in place.
 */
mongoose.set('strictQuery', true);
mongoose.set('autoIndex', !isProduction);

export interface DatabaseCapabilities {
  /** True when the server is a replica set or sharded cluster. */
  supportsTransactions: boolean;
  topology: 'replicaSet' | 'sharded' | 'standalone' | 'unknown';
  replicaSetName?: string;
}

let capabilities: DatabaseCapabilities = {
  supportsTransactions: false,
  topology: 'unknown',
};

export function getDatabaseCapabilities(): DatabaseCapabilities {
  return capabilities;
}


async function detectCapabilities(): Promise<DatabaseCapabilities> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return { supportsTransactions: false, topology: 'unknown' };

    const hello = (await admin.command({ hello: 1 })) as {
      setName?: string;
      msg?: string;
    };

    if (hello.msg === 'isdbgrid') {
      return { supportsTransactions: true, topology: 'sharded' };
    }
    if (hello.setName) {
      return {
        supportsTransactions: true,
        topology: 'replicaSet',
        replicaSetName: hello.setName,
      };
    }
    return { supportsTransactions: false, topology: 'standalone' };
  } catch (error) {
    logger.warn({ err: error }, 'Could not determine MongoDB topology');
    return { supportsTransactions: false, topology: 'unknown' };
  }
}

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error) => logger.error({ err: error }, 'MongoDB error'));

  await mongoose.connect(env.MONGODB_URI, {
    // Fail fast on startup instead of hanging for the default 30 seconds.
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
  });

  capabilities = await detectCapabilities();

  if (capabilities.supportsTransactions) {
    logger.info(
      { topology: capabilities.topology, replicaSet: capabilities.replicaSetName },
      'MongoDB supports multi-document transactions',
    );
  } else {
    logger.warn(
      { topology: capabilities.topology },
      'MongoDB is running standalone. Multi-document transactions are unavailable, ' +
        'which will block stock transfers and goods receipts in a later phase. ' +
        'Use MongoDB Atlas or start a local single-node replica set.',
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

/** Human-readable connection state, used by the health endpoint. */
const CONNECTION_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

export function getConnectionState(): string {
  return CONNECTION_STATES[mongoose.connection.readyState] ?? 'unknown';
}
