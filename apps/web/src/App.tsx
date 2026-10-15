import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Store } from 'lucide-react';
import type { Permission } from '@shopos/shared';
import { useAuthStore } from '@/stores/authStore';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { ProductDetailPage } from '@/features/products/ProductDetailPage';
import { RatesPage } from '@/features/pricing/RatesPage';
import { StockPage } from '@/features/inventory/StockPage';
import { TransfersPage } from '@/features/inventory/TransfersPage';
import { MovementsPage } from '@/features/inventory/MovementsPage';
import { BranchesPage } from '@/features/admin/BranchesPage';
import { StaffPage } from '@/features/admin/StaffPage';
import { RolesPage } from '@/features/admin/RolesPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { ActivityPage } from '@/features/admin/ActivityPage';
import { SystemStatusPage } from '@/pages/SystemStatusPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { SupplierDetailPage } from '@/features/purchasing/SupplierDetailPage';
import { InvoicesPage } from '@/features/sales/InvoicesPage';
import { InvoiceDetailPage } from '@/features/sales/InvoiceDetailPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { QuotationsPage } from '@/features/sales/QuotationsPage';
import { QuotationDetailPage } from '@/features/sales/QuotationDetailPage';
import { SalesOrdersPage } from '@/features/sales/SalesOrdersPage';
import { SalesOrderDetailPage } from '@/features/sales/SalesOrderDetailPage';
import { SuppliersPage } from '@/features/purchasing/SuppliersPage';
import { PurchaseOrdersPage } from '@/features/purchasing/PurchaseOrdersPage';
import { PurchaseOrderDetailPage } from '@/features/purchasing/PurchaseOrderDetailPage';

/**
 * Routing.
 *
 * `RequireAuth` waits for the bootstrap refresh to settle before deciding
 * anything. Without that wait, a page reload would flash the login screen for a
 * moment even though the refresh cookie was about to restore the session - which
 * looks like being logged out at random.
 *
 * `RequirePermission` keeps a user from landing on a screen they cannot use. It
 * is a courtesy, not a security control: the API refuses the underlying request
 * whatever the browser renders.
 */

function FullPageLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Store className="h-8 w-8 animate-pulse text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">Loading ShopOS...</p>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const location = useLocation();

  if (isBootstrapping) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const permissions = useAuthStore((state) => state.session?.membership.permissions ?? []);

  if (!permissions.includes(permission)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold">You do not have access to this screen</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask the owner to give you the <code className="tabular">{permission}</code> permission.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);

  if (isBootstrapping) return <FullPageLoader />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route
          path="products"
          element={
            <RequirePermission permission="products:view">
              <ProductsPage />
            </RequirePermission>
          }
        />
        <Route
          path="products/:id"
          element={
            <RequirePermission permission="products:view">
              <ProductDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="rates"
          element={
            <RequirePermission permission="pricing:view">
              <RatesPage />
            </RequirePermission>
          }
        />
        <Route
          path="stock"
          element={
            <RequirePermission permission="inventory:view">
              <StockPage />
            </RequirePermission>
          }
        />
        <Route
          path="transfers"
          element={
            <RequirePermission permission="inventory:view">
              <TransfersPage />
            </RequirePermission>
          }
        />
        <Route
          path="movements"
          element={
            <RequirePermission permission="inventory:view">
              <MovementsPage />
            </RequirePermission>
          }
        />

        <Route
          path="customers"
          element={
            <RequirePermission permission="customers:view">
              <CustomersPage />
            </RequirePermission>
          }
        />
        <Route
          path="customers/:id"
          element={
            <RequirePermission permission="customers:view">
              <CustomerDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales"
          element={
            <RequirePermission permission="sales:view">
              <InvoicesPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales/:id"
          element={
            <RequirePermission permission="sales:view">
              <InvoiceDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="quotations"
          element={
            <RequirePermission permission="sales:view">
              <QuotationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="quotations/:id"
          element={
            <RequirePermission permission="sales:view">
              <QuotationDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales-orders"
          element={
            <RequirePermission permission="sales:view">
              <SalesOrdersPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales-orders/:id"
          element={
            <RequirePermission permission="sales:view">
              <SalesOrderDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments"
          element={
            <RequirePermission permission="payments:view">
              <PaymentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="suppliers"
          element={
            <RequirePermission permission="suppliers:view">
              <SuppliersPage />
            </RequirePermission>
          }
        />
        <Route
          path="suppliers/:id"
          element={
            <RequirePermission permission="suppliers:view">
              <SupplierDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="purchases"
          element={
            <RequirePermission permission="purchases:view">
              <PurchaseOrdersPage />
            </RequirePermission>
          }
        />
        <Route
          path="purchases/:id"
          element={
            <RequirePermission permission="purchases:view">
              <PurchaseOrderDetailPage />
            </RequirePermission>
          }
        />

        <Route
          path="admin/branches"
          element={
            <RequirePermission permission="branches:view">
              <BranchesPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/staff"
          element={
            <RequirePermission permission="users:view">
              <StaffPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/roles"
          element={
            <RequirePermission permission="users:view">
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequirePermission permission="organization:manage">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/activity"
          element={
            <RequirePermission permission="audit_logs:view">
              <ActivityPage />
            </RequirePermission>
          }
        />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin/system" element={<SystemStatusPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
