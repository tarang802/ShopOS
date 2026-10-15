import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ChevronDown,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { PERMISSIONS, type Permission } from '@shopos/shared';
import { api } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { useBranches } from '@/hooks/useBranches';
import { LABELS, type Label } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { queryClient } from '@/lib/queryClient';

/**
 * The application shell.
 *
 * Three things sit in the shell rather than on any one page, because they are
 * needed from everywhere:
 *
 *  - The product search box. Looking up a rate is the single most frequent thing
 *    anyone does in ShopOS, and making staff navigate to a page first would put
 *    a click between them and a waiting customer.
 *  - The branch selector. "Which godown are we talking about" is the second
 *    question in almost every conversation in a multi-branch business.
 *  - Who is signed in, and a way out.
 *
 * Navigation entries are filtered by permission, so an inventory hand simply
 * never sees a Rates menu. That is a courtesy, not a security measure - the
 * server refuses the request regardless.
 *
 * The look is the ledger's: a navy spine down the left with brass headings, and a
 * ruled bar across the top.
 */

interface NavItem {
  to: string;
  label: Label;
  icon: typeof LayoutDashboard;
  permission?: Permission;
}

const OPERATIONS: NavItem[] = [
  { to: '/', label: LABELS.dashboard, icon: LayoutDashboard },
  { to: '/products', label: LABELS.products, icon: Package, permission: PERMISSIONS.PRODUCTS_VIEW },
  { to: '/rates', label: LABELS.rates, icon: Tags, permission: PERMISSIONS.PRICING_VIEW },
  { to: '/stock', label: LABELS.stock, icon: Warehouse, permission: PERMISSIONS.INVENTORY_VIEW },
  {
    to: '/transfers',
    label: LABELS.transfers,
    icon: ArrowLeftRight,
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    to: '/movements',
    label: LABELS.movements,
    icon: History,
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  { to: '/customers', label: LABELS.customers, icon: Users, permission: PERMISSIONS.CUSTOMERS_VIEW },
  { to: '/sales', label: LABELS.sales, icon: Receipt, permission: PERMISSIONS.SALES_VIEW },
  { to: '/payments', label: LABELS.payments, icon: Banknote, permission: PERMISSIONS.PAYMENTS_VIEW },
  { to: '/suppliers', label: LABELS.suppliers, icon: Truck, permission: PERMISSIONS.SUPPLIERS_VIEW },
  { to: '/purchases', label: LABELS.purchases, icon: ShoppingCart, permission: PERMISSIONS.PURCHASES_VIEW },
];

const ADMINISTRATION: NavItem[] = [
  {
    to: '/admin/branches',
    label: LABELS.branches,
    icon: Building2,
    permission: PERMISSIONS.BRANCHES_VIEW,
  },
  { to: '/admin/staff', label: LABELS.staff, icon: Users, permission: PERMISSIONS.USERS_VIEW },
  { to: '/admin/roles', label: LABELS.roles, icon: ShieldCheck, permission: PERMISSIONS.USERS_VIEW },
  {
    to: '/admin/settings',
    label: LABELS.settings,
    icon: Settings,
    permission: PERMISSIONS.ORGANIZATION_MANAGE,
  },
  {
    to: '/admin/activity',
    label: LABELS.auditLog,
    icon: ScrollText,
    permission: PERMISSIONS.AUDIT_LOGS_VIEW,
  },
];

function NavSection({
  title,
  items,
  permissions,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  permissions: Permission[];
  onNavigate: () => void;
}) {
  const visible = items.filter((item) => !item.permission || permissions.includes(item.permission));
  if (visible.length === 0) return null;

  return (
    <div className="mb-5">
      <p className="mx-3 mb-2 border-b border-sidebar-foreground/15 pb-1.5 font-serif text-[11px] font-semibold uppercase tracking-[0.2em] text-brass">
        {title}
      </p>
      <nav className="flex flex-col">
        {visible.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 border-l-[3px] px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-brass bg-sidebar-foreground/10 font-semibold text-sidebar-foreground'
                  : 'border-transparent text-sidebar-foreground/80 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{label.en}</span>
            <span className="text-[11px] text-sidebar-muted">{label.hi}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const setActiveBranch = useAuthStore((state) => state.setActiveBranch);

  const [searchTerm, setSearchTerm] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const permissions = session?.membership.permissions ?? [];
  const { data: branches } = useBranches(permissions.includes(PERMISSIONS.BRANCHES_VIEW));

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      clearSession();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    navigate(`/products?search=${encodeURIComponent(term)}`);
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b-[3px] border-double border-brass/60 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Store className="h-6 w-6 text-brass" aria-hidden />
          <span className="font-serif text-2xl font-semibold tracking-wide">ShopOS</span>
        </div>
        <p className="mt-1 font-serif text-xs italic text-sidebar-muted">The trader&apos;s ledger</p>
      </div>
      <div className="flex-1 overflow-y-auto py-5">
        <NavSection
          title="Daily work"
          items={OPERATIONS}
          permissions={permissions}
          onNavigate={() => setMenuOpen(false)}
        />
        <NavSection
          title="Administration"
          items={ADMINISTRATION}
          permissions={permissions}
          onNavigate={() => setMenuOpen(false)}
        />
      </div>
      <div className="border-t border-sidebar-foreground/15 px-5 py-3">
        <p className="truncate font-serif text-sm font-semibold">{session?.organization.name}</p>
        <p className="text-xs text-sidebar-muted">{session?.membership.roleName}</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r-2 border-primary lg:block print:hidden">
        {sidebar}
      </aside>

      {/* The sidebar becomes a drawer below the large breakpoint, because plenty
          of shop staff will open this on a phone behind the counter. */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 border-r-2 border-primary">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b-2 border-primary bg-card px-4 shadow-[0_2px_0_0_var(--brass)] print:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          <form onSubmit={submitSearch} className="relative min-w-0 max-w-lg flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search product, item code or barcode..."
              aria-label="Search products"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] placeholder:text-muted-foreground"
            />
          </form>

          {branches && branches.length > 1 && (
            <Select
              aria-label="Branch"
              className="hidden h-9 w-44 sm:block"
              value={activeBranchId ?? ''}
              onChange={(event) => setActiveBranch(event.target.value || null)}
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary font-serif text-[12px] font-semibold text-primary-foreground">
                {session?.user.name.charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-28 truncate sm:inline">{session?.user.name}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>

            {userMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close user menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-11 z-20 w-56 rounded-md border-2 border-primary bg-popover p-1 shadow-lg">
                  <div className="border-b border-border px-3 py-2">
                    <p className="truncate font-serif text-sm font-semibold">{session?.user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{session?.user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => logout.mutate()}
                    className="mt-1 flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
