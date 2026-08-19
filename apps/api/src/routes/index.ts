import { Router } from 'express';
import { healthRouter } from '../modules/health/health.routes';

/**
 * The v1 API router.
 *
 * Every module registers here, which keeps the URL surface visible in one file
 * instead of scattered across app.ts. Modules are added as their phases land.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);

// Phase 3+  auth, organizations, branches, users, roles
// Phase 6+  products, categories, brands, units
// Phase 7+  price-lists, pricing
// Phase 8+  inventory, stock-transfers
// Phase 9+  suppliers, purchases
// Phase 10+ customers, quotations
// Phase 11+ sales-orders, invoices
// Phase 12+ payments
// Phase 13+ audit-logs, notifications
// Phase 15+ reports
