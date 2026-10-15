#!/usr/bin/env node
/**
 * Start a private single-node MongoDB replica set for development.
 *
 * WHY: ShopOS needs multi-document transactions for stock transfers, goods
 * receipts and invoices, and MongoDB only offers those on a replica set. A
 * normal `mongod` install is standalone, and turning it into a replica set by
 * hand means editing a system config file and restarting a service. This runs
 * a separate instance on its own port with its own data directory, so the
 * system MongoDB is never touched.
 *
 *   npm run db:local
 *
 * then set  MONGODB_URI=mongodb://127.0.0.1:27018/shopos?replicaSet=rs0
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.LOCAL_MONGO_PORT ?? 27018);
const dbPath = process.env.LOCAL_MONGO_DBPATH ?? join(root, 'data', 'mongo-dev');
const replicaSet = 'rs0';

function findMongod() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;

  if (process.platform === 'win32') {
    const base = 'C:/Program Files/MongoDB/Server';
    if (existsSync(base)) {
      const versions = readdirSync(base).sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }),
      );
      for (const version of versions) {
        const candidate = join(base, version, 'bin', 'mongod.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  // Otherwise rely on PATH.
  return 'mongod';
}

async function initiateReplicaSet() {
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, {
    serverSelectionTimeoutMS: 2000,
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await client.connect();
      const admin = client.db('admin');
      try {
        await admin.command({ replSetGetStatus: 1 });
      } catch (error) {
        if (error?.codeName === 'NotYetInitialized' || error?.code === 94) {
          await admin.command({
            replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
          });
        } else {
          throw error;
        }
      }
      await client.close();
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
  await client.close().catch(() => undefined);
  throw new Error('MongoDB started but the replica set could not be initiated');
}

mkdirSync(dbPath, { recursive: true });

const mongod = spawn(
  findMongod(),
  ['--dbpath', dbPath, '--port', String(port), '--replSet', replicaSet, '--bind_ip', '127.0.0.1'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

mongod.on('error', (error) => {
  console.error(
    `Could not start mongod (${error.message}). Install MongoDB, or set MONGOD_PATH to its mongod binary.`,
  );
  process.exit(1);
});
mongod.on('exit', (code) => process.exit(code ?? 0));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => mongod.kill(signal));
}

initiateReplicaSet()
  .then(() => {
    console.log('');
    console.log(`  Local MongoDB replica set is ready on port ${port}.`);
    console.log(`  MONGODB_URI=mongodb://127.0.0.1:${port}/shopos?replicaSet=${replicaSet}`);
    console.log('');
  })
  .catch((error) => {
    console.error(error.message);
    mongod.kill();
    process.exit(1);
  });
