import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  Boxes,
  Building2,
  FileBarChart,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The application shell: persistent sidebar, top bar, routed content.
 *
 * The navigation mirrors how a shop is actually run - the operational modules
 * staff use all day sit at the top, and administration is separated below so it
 * is out of the way of daily work.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const OPERATIONS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/pricing', label: 'Pricing', icon: Tags },
  { to: '/inventory', label: 'Inventory', icon: Warehouse },
  { to: '/purchasing', label: 'Purchasing', icon: Truck },
  { to: '/sales', label: 'Sales', icon: ShoppingCart },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/suppliers', label: 'Suppliers', icon: Boxes },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

const ADMINISTRATION: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/roles', label: 'Roles', icon: ShieldCheck },
  { to: '/admin/branches', label: 'Branches', icon: Building2 },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
  { to: '/admin/system', label: 'System Status', icon: Activity },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="mb-6">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <nav className="flex flex-col gap-0.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <Receipt className="h-5 w-5 text-primary" aria-hidden />
          <span className="text-base font-semibold tracking-tight">ShopOS</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <NavSection title="Operations" items={OPERATIONS} />
          <NavSection title="Administration" items={ADMINISTRATION} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
          {/* Product search is the single most-used control in ShopOS, so it
              lives in the shell rather than on one page. Wired up in Phase 6. */}
          <input
            type="search"
            disabled
            placeholder="Search products by name, SKU or barcode..."
            className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-60"
            aria-label="Search products"
          />
          <span className="hidden text-xs text-muted-foreground sm:inline">Phase 1 skeleton</span>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
