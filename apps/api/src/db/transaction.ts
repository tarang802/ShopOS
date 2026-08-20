import mongoose, { type ClientSession } from 'mongoose';
import { getDatabaseCapabilities } from '../config/database';
import { logger } from '../core/logger';

/**
 * Run several writes as one all-or-nothing unit.
 *
 * WHY ShopOS needs this: a stock transfer subtracts from one branch, adds to
 * another, and writes two ledger rows. If the process dies halfway, stock has
 * vanished from Bhagalpur without appearing in Patna - the business has lost
 * goods on paper. A transaction makes that impossible.
 *
 * THE CAVEAT, stated plainly: MongoDB only supports multi-document transactions
 * on a replica set or a sharded cluster. On a standalone server the callback
 * still runs, but WITHOUT atomicity - a mid-way failure can leave partial data.
 * That is why the API warns loudly at startup and the System Status screen shows
 * whether transactions are available. Development on a standalone server is
 * fine; running a real shop on one is not.
 *
 * Every write inside the callback must pass the session through, or it will not
 * be part of the transaction.
 */
export async function withTransaction<T>(
  operation: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  if (!getDatabaseCapabilities().supportsTransactions) {
    logger.debug('Running without a transaction: MongoDB is not a replica set');
    return operation(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    // withTransaction retries on transient errors such as write conflicts,
    // which is exactly what two staff members saving at once produces.
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

/**
 * Spread into a Mongoose call to attach the session when there is one.
 *
 *   await Product.create([doc], { ...sessionOption(session) })
 */
export function sessionOption(session: ClientSession | undefined): { session?: ClientSession } {
  return session ? { session } : {};
}
