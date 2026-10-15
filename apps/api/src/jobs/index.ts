import { env } from '../config/env';
import { logger } from '../core/logger';
import { runOverdueSweep } from './overdueSweep';

/**
 * Background work that runs inside the API process.
 *
 * One timer is enough for a business this size, and it keeps deployment to a single
 * process. The sweep is idempotent - every notification it creates carries a dedupe
 * key - so running it on several instances at once is wasteful but never wrong.
 * `JOBS_ENABLED=false` turns it off on all but one instance if that matters.
 */

const HOUR_MS = 3_600_000;
/** Give the server a moment to settle before the first sweep. */
const FIRST_RUN_DELAY_MS = 30_000;

let timers: NodeJS.Timeout[] = [];

async function safely(name: string, job: () => Promise<unknown>): Promise<void> {
  try {
    await job();
  } catch (error) {
    // A failed sweep is logged and retried next hour; it must never take the API down.
    logger.error({ err: error, job: name }, 'Background job failed');
  }
}

export function startBackgroundJobs(): void {
  if (!env.JOBS_ENABLED) {
    logger.info('Background jobs are disabled');
    return;
  }

  const first = setTimeout(() => void safely('overdue-sweep', runOverdueSweep), FIRST_RUN_DELAY_MS);
  const repeat = setInterval(() => void safely('overdue-sweep', runOverdueSweep), HOUR_MS);

  // Neither timer should keep the process alive on its own at shutdown.
  first.unref();
  repeat.unref();
  timers = [first, repeat];
}

export function stopBackgroundJobs(): void {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers = [];
}
