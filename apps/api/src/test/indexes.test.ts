import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureIndexes } from '../db/indexes';
import { Invoice, Organization, User } from '../db/models';
import { startApi, type TestServer } from './testkit';

/**
 * Production switches automatic indexing off, so a new database is only as safe as
 * the explicit step that builds its indexes. These are the ones that matter most:
 * the unique constraints behind "one account per email" and "one invoice number".
 */

let server: TestServer;

beforeAll(async () => {
  server = await startApi();
});

afterAll(async () => {
  await server.close();
});

const uniqueKeys = async (model: mongoose.Model<any>) =>
  (await model.collection.indexes()).filter((index) => index.unique).map((index) => Object.keys(index.key).join('+'));

describe('index creation at startup', () => {
  it('builds the unique constraints a new production database depends on', async () => {
    await ensureIndexes();

    expect(await uniqueKeys(User)).toContain('email');
    expect(await uniqueKeys(Organization)).toContain('slug');
    expect(await uniqueKeys(Invoice)).toContain('organizationId+number');
  });

  it('is safe to run again and again, on every boot', async () => {
    await ensureIndexes();
    const before = (await Invoice.collection.indexes()).length;
    await ensureIndexes();
    expect((await Invoice.collection.indexes()).length).toBe(before);
  });

  it('actually refuses a second account with the same email', async () => {
    const email = `unique-${Date.now()}@example.test`;
    const make = () => User.create({ name: 'Dup Test', email, authProviders: ['PASSWORD'], isActive: true } as any);
    await make();
    await expect(make()).rejects.toMatchObject({ code: 11000 });
  });
});
