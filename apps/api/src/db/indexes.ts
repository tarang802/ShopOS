import mongoose from 'mongoose';
import { logger } from '../core/logger';

/**
 * Create every index the models declare.
 *
 * Mongoose builds indexes by itself outside production (`autoIndex`), but in
 * production that is switched off so a deploy cannot lock a busy collection. Left
 * at that, a brand-new production database would have NO indexes at all - including
 * the unique ones that make a duplicate email, business slug or invoice number
 * impossible. So production creates them here, once, deliberately, before it starts
 * taking requests.
 *
 * This only ever *adds* missing indexes: it never drops or changes an existing one,
 * and it is a no-op when everything is already there. Indexes are built one
 * collection at a time. An index that cannot be built (typically a unique index over
 * data that already contains duplicates) rejects, and startup stops rather than run
 * without the guarantee; set SYNC_INDEXES=false to bypass it deliberately.
 */
export async function ensureIndexes(): Promise<number> {
  const models = Object.values(mongoose.models);
  const started = Date.now();

  for (const model of models) {
    await model.createIndexes();
  }

  logger.info({ models: models.length, ms: Date.now() - started }, 'Database indexes are in place');
  return models.length;
}
