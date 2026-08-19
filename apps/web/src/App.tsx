import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { SystemStatusPage } from '@/pages/SystemStatusPage';

/**
 * Route table.
 *
 * Every navigation entry resolves today. Placeholders name the phase that will
 * replace them, so the route map doubles as the build plan.
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <PlaceholderPage
              title="Dashboard"
              phase="Phase 14"
              description="Sales so far today, low stock, recent activity and branch comparison."
            />
          }
        />
        <Route
          path="products"
          element={
            <PlaceholderPage
              title="Products"
              phase="Phase 6"
              description="The catalogue: names, SKUs, barcodes, brands, categories and units."
            />
          }
        />
        <Route
          path="pricing"
          element={
            <PlaceholderPage
              title="Pricing"
              phase="Phase 7"
              description="Price lists and quantity-based tiers for retail, wholesale and dealer rates."
            />
          }
        />
        <Route
          path="inventory"
          element={
            <PlaceholderPage
              title="Inventory"
              phase="Phase 8"
              description="Branch-wise stock, adjustments, transfers and the movement ledger."
            />
          }
        />
        <Route
          path="purchasing"
          element={
            <PlaceholderPage
              title="Purchasing"
              phase="Phase 9"
              description="Purchase orders and goods receipts, including partial deliveries."
            />
          }
        />
        <Route
          path="sales"
          element={
            <PlaceholderPage
              title="Sales"
              phase="Phase 10-11"
              description="Quotations, sales orders and invoices."
            />
          }
        />
        <Route
          path="customers"
          element={
            <PlaceholderPage
              title="Customers"
              phase="Phase 10"
              description="Customer records, default price list and outstanding balance."
            />
          }
        />
        <Route
          path="suppliers"
          element={
            <PlaceholderPage
              title="Suppliers"
              phase="Phase 9"
              description="Supplier records and purchase history."
            />
          }
        />
        <Route
          path="reports"
          element={
            <PlaceholderPage
              title="Reports"
              phase="Phase 15"
              description="Sales, stock valuation, outstanding payments and branch comparison."
            />
          }
        />

        <Route
          path="admin/users"
          element={
            <PlaceholderPage
              title="Users"
              phase="Phase 4"
              description="Invite staff and assign them to branches."
            />
          }
        />
        <Route
          path="admin/roles"
          element={
            <PlaceholderPage
              title="Roles"
              phase="Phase 5"
              description="Permission bundles that decide what each staff member can do."
            />
          }
        />
        <Route
          path="admin/branches"
          element={
            <PlaceholderPage
              title="Branches"
              phase="Phase 4"
              description="The physical locations that hold stock."
            />
          }
        />
        <Route
          path="admin/settings"
          element={
            <PlaceholderPage
              title="Settings"
              phase="Phase 4"
              description="Organization profile, currency and stock policy."
            />
          }
        />
        <Route
          path="admin/audit-logs"
          element={
            <PlaceholderPage
              title="Audit Logs"
              phase="Phase 13"
              description="Who changed what, when, and what the value was before."
            />
          }
        />
        <Route path="admin/system" element={<SystemStatusPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
