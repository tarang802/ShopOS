import { Router } from 'express';
import { auditRouter } from '../modules/audit/audit.routes';
import { customersRouter } from '../modules/customers/customers.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { branchesRouter } from '../modules/branches/branches.routes';
import { brandsRouter, categoriesRouter, unitsRouter } from '../modules/catalog/catalog.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { healthRouter } from '../modules/health/health.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { organizationsRouter } from '../modules/organizations/organizations.routes';
import { paymentsRouter } from '../modules/payments/payments.routes';
import { purchaseOrdersRouter, suppliersRouter } from '../modules/purchasing/purchasing.routes';
import { purchaseReturnsRouter } from '../modules/purchasing/purchaseReturns.routes';
import { supplierPaymentsRouter } from '../modules/purchasing/supplierPayments.routes';
import { pricingRouter } from '../modules/pricing/pricing.routes';
import { productsRouter } from '../modules/products/products.routes';
import { invoicesRouter } from '../modules/sales/invoices.routes';
import { quotationsRouter } from '../modules/sales/quotations.routes';
import { salesOrdersRouter } from '../modules/sales/salesOrders.routes';
import { salesReturnsRouter } from '../modules/sales/salesReturns.routes';
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

apiRouter.use('/customers', customersRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/quotations', quotationsRouter);
apiRouter.use('/sales-orders', salesOrdersRouter);
apiRouter.use('/sales-returns', salesReturnsRouter);

apiRouter.use('/suppliers', suppliersRouter);
apiRouter.use('/purchase-orders', purchaseOrdersRouter);
apiRouter.use('/purchase-returns', purchaseReturnsRouter);
apiRouter.use('/supplier-payments', supplierPaymentsRouter);

apiRouter.use('/payments', paymentsRouter);

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/audit-logs', auditRouter);

// Phase 15+ reports
