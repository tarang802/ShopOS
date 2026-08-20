import { Router } from 'express';
import { auditRouter } from '../modules/audit/audit.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { branchesRouter } from '../modules/branches/branches.routes';
import { brandsRouter, categoriesRouter, unitsRouter } from '../modules/catalog/catalog.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { healthRouter } from '../modules/health/health.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { organizationsRouter } from '../modules/organizations/organizations.routes';
import { pricingRouter } from '../modules/pricing/pricing.routes';
import { productsRouter } from '../modules/products/products.routes';
import { rolesRouter } from '../modules/roles/roles.routes';
import { usersRouter } from '../modules/users/users.routes';

/**
 * The v1 API router.
 *
 * Every module registers here, which keeps the URL surface visible in one file
 * instead of scattered across app.ts.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/branches', branchesRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/roles', rolesRouter);

apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/brands', brandsRouter);
apiRouter.use('/units', unitsRouter);
apiRouter.use('/products', productsRouter);

apiRouter.use('/pricing', pricingRouter);
apiRouter.use('/inventory', inventoryRouter);

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/audit-logs', auditRouter);

// Phase 9+  suppliers, purchases
// Phase 10+ customers, quotations
// Phase 11+ sales-orders, invoices
// Phase 12+ payments
// Phase 15+ reports
