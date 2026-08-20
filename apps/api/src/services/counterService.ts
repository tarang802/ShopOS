import type { ClientSession, Types } from 'mongoose';
import { Counter } from '../db/models';
import { sessionOption } from '../db/transaction';

/**
 * Sequential document numbers that never collide.
 *
 * `findOneAndUpdate` with `$inc` is atomic inside MongoDB: two staff members
 * saving at the same instant are guaranteed different numbers, with no lock and
 * no transaction. Reading a count and adding one would give them both the same
 * number, and duplicate bill numbers in a business record are a real problem -
 * they break reconciliation and look like fraud to an auditor.
 */
async function nextValue(
  organizationId: Types.ObjectId,
  key: string,
  session?: ClientSession,
): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { organizationId, key },
    { $inc: { value: 1 } },
    { returnDocument: 'after', upsert: true, ...sessionOption(session) },
  ).lean();

  return counter?.value ?? 1;
}

/**
 * A padded document number, e.g. ADJ-2026-000042.
 *
 * The year is part of the counter key, so numbering restarts each financial year
 * the way Indian businesses expect, rather than climbing forever.
 */
export async function nextDocumentNumber(
  organizationId: Types.ObjectId,
  prefix: string,
  session?: ClientSession,
): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const value = await nextValue(organizationId, key, session);
  return `${prefix}-${year}-${String(value).padStart(6, '0')}`;
}

/**
 * An item code for a product the owner did not name themselves.
 *
 * Kept short and typeable, because staff read these aloud across a counter.
 */
export async function nextSku(
  organizationId: Types.ObjectId,
  session?: ClientSession,
): Promise<string> {
  const value = await nextValue(organizationId, 'SKU', session);
  return `SKU${String(value).padStart(5, '0')}`;
}
