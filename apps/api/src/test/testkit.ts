import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';

/**
 * A running API and a fresh business to test against.
 *
 * Every spec file boots the real app on an ephemeral port and registers its own
 * business through the real sign-up route, so the tests exercise exactly what a new
 * customer would, and two files can never see each other's data.
 */

export interface ApiResponse<T = any> {
  status: number;
  body: any;
  data: T;
}

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startApi(): Promise<TestServer> {
  await connectDatabase();

  // Unique indexes are built in the background when models load. A test that races
  // the first request would find them missing, so wait for every model's indexes.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const server: Server = await new Promise((resolve) => {
    const listening = createApp().listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await disconnectDatabase();
    },
  };
}

export type Client = ReturnType<typeof clientFor>;

export function clientFor(server: TestServer, token?: string) {
  async function call(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed, data: parsed?.data };
  }

  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => call('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => call('PATCH', path, body ?? {}),
  };
}

let sequence = 0;

export interface Business {
  api: Client;
  anonymous: Client;
  token: string;
  organizationId: string;
  mainBranchId: string;
  priceListId: string;
  unitId: string;
  secondBranch: () => Promise<string>;
  product: (options: ProductOptions) => Promise<string>;
  customer: (options?: { name?: string; creditDays?: number; creditLimitPaise?: number }) => Promise<string>;
  supplier: (options?: { name?: string; creditDays?: number }) => Promise<string>;
  /** A signed-in member with the given starting role, limited to some branches or to all. */
  staff: (roleCode: string, options?: { branchIds?: string[] }) => Promise<Client>;
}

export interface ProductOptions {
  name?: string;
  /** The rate for every quantity, in paise. */
  pricePaise?: number;
  tiers?: { minQuantity: number; maxQuantity: number | null; pricePaise: number }[];
  stock?: number;
  taxRatePercent?: number;
  reorderLevel?: number;
  costPricePaise?: number;
  branchId?: string;
}

/** Register a new business through the real sign-up route and return helpers bound to it. */
export async function newBusiness(server: TestServer): Promise<Business> {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}-${Math.floor(Math.random() * 1e6)}`;

  const anonymous = clientFor(server);
  const registered = await anonymous.post('/auth/register', {
    name: 'Test Owner',
    email: `owner-${stamp}@example.test`,
    password: 'a-long-enough-password',
    businessName: `Test Traders ${stamp}`,
  });
  if (registered.status !== 201 && registered.status !== 200) {
    throw new Error(`Could not register a test business: ${JSON.stringify(registered.body)}`);
  }

  const token: string = registered.data.accessToken;
  const api = clientFor(server, token);

  const [branches, lists, units] = await Promise.all([
    api.get('/branches'),
    api.get('/pricing/lists'),
    api.get('/units?limit=100'),
  ]);
  const mainBranchId: string = branches.data[0]._id;
  const priceListId: string = lists.data.find((list: any) => list.isDefault)._id;
  const unitId: string = units.data.find((unit: any) => unit.symbol === 'pcs')._id;

  let products = 0;
  let staffCount = 0;
  let extraBranches = 0;

  return {
    api,
    anonymous,
    token,
    organizationId: registered.data.organization.id,
    mainBranchId,
    priceListId,
    unitId,

    async secondBranch() {
      extraBranches += 1;
      const created = await api.post('/branches', {
        name: `Branch ${extraBranches}`,
        code: `B${extraBranches}${stamp.slice(-4)}`,
      });
      if (created.status !== 201) throw new Error(`Could not add a branch: ${JSON.stringify(created.body)}`);
      return created.data._id as string;
    },

    async product(options: ProductOptions) {
      products += 1;
      const created = await api.post('/products', {
        name: options.name ?? `Product ${products}`,
        unitId,
        taxRatePercent: options.taxRatePercent ?? 12,
        reorderLevel: options.reorderLevel ?? 0,
        ...(options.costPricePaise !== undefined ? { costPricePaise: options.costPricePaise } : {}),
      });
      if (created.status !== 201) throw new Error(`Could not add a product: ${JSON.stringify(created.body)}`);
      const productId: string = created.data._id;

      const priced = await api.put(`/pricing/products/${productId}`, {
        priceListId,
        tiers: options.tiers ?? [{ minQuantity: 1, maxQuantity: null, pricePaise: options.pricePaise ?? 1000 }],
      });
      if (priced.status !== 200) throw new Error(`Could not price a product: ${JSON.stringify(priced.body)}`);

      if (options.stock && options.stock > 0) {
        const stocked = await api.post('/inventory/opening-stock', {
          branchId: options.branchId ?? mainBranchId,
          items: [{ productId, quantity: options.stock }],
        });
        if (stocked.status !== 200 && stocked.status !== 201) {
          throw new Error(`Could not set opening stock: ${JSON.stringify(stocked.body)}`);
        }
      }
      return productId;
    },

    async customer(options = {}) {
      const created = await api.post('/customers', {
        name: options.name ?? `Customer ${stamp}`,
        creditDays: options.creditDays ?? 0,
        ...(options.creditLimitPaise !== undefined ? { creditLimitPaise: options.creditLimitPaise } : {}),
      });
      return created.data._id as string;
    },

    async staff(roleCode, options = {}) {
      staffCount += 1;
      const roles = await api.get('/roles');
      const roleId = roles.data.find((role: any) => role.code === roleCode)._id as string;
      const email = `staff-${roleCode.toLowerCase()}-${stamp}-${staffCount}@example.test`;
      const created = await api.post('/users', {
        name: 'Test Staff',
        email,
        password: 'a-long-enough-password',
        roleId,
        allBranches: !options.branchIds,
        branchIds: options.branchIds ?? [],
      });
      if (created.status !== 201) throw new Error(`Could not add staff: ${JSON.stringify(created.body)}`);
      const login = await anonymous.post('/auth/login', { email, password: 'a-long-enough-password' });
      return clientFor(server, login.data.accessToken);
    },

    async supplier(options = {}) {
      const created = await api.post('/suppliers', {
        name: options.name ?? `Supplier ${stamp}`,
        creditDays: options.creditDays ?? 0,
      });
      return created.data._id as string;
    },
  };
}

/** How many of these responses had a given status. */
export function countStatus(responses: ApiResponse[], status: number): number {
  return responses.filter((response) => response.status === status).length;
}
