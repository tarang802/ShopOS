import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { ALL_PERMISSIONS, type Permission } from '@shopos/shared';
import { api } from '@/lib/apiClient';
import { LABELS } from '@/lib/labels';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/**
 * Roles: what each kind of staff member is allowed to do.
 *
 * A role is a bundle of permissions, stored as ordinary data. Nothing in the
 * code asks "is this person a manager" - it asks whether they hold
 * `pricing:update`. That indirection is what lets one shop let its manager set
 * rates while another does not, with no change to ShopOS itself.
 *
 * Permissions are grouped by the part of the business they cover, because
 * thirty-odd checkboxes in a flat list is not something an owner can reason
 * about.
 */

interface Role {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  permissions: Permission[];
  isSystem: boolean;
  memberCount: number;
}

const GROUP_LABELS: Record<string, string> = {
  products: 'Products',
  pricing: 'Rates',
  inventory: 'Stock',
  purchases: 'Purchasing',
  sales: 'Sales',
  customers: 'Customers',
  suppliers: 'Suppliers',
  payments: 'Payments',
  costs: 'Costs and margins',
  reports: 'Reports',
  users: 'Staff',
  roles: 'Roles',
  branches: 'Branches',
  organization: 'Business',
  audit_logs: 'Activity log',
};

function groupOf(permission: string): string {
  return permission.split(':')[0] ?? 'other';
}

export function RolesPage() {
  const { data: roles, isPending } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/roles'),
  });

  const groups = [...new Set(ALL_PERMISSIONS.map(groupOf))];

  return (
    <div className="mx-auto max-w-5xl">
      <LabelledPageHeader
        label={LABELS.roles}
        description="What each kind of staff member can see and change"
      />

      {isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading roles...</p>
      ) : !roles || roles.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No roles" message="No roles have been set up yet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.map((role) => {
            const held = new Set(role.permissions);
            return (
              <Card key={role._id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {role.name}
                    {role.isSystem && <Badge variant="outline">Built in</Badge>}
                    <Badge variant="default">
                      {role.memberCount} {role.memberCount === 1 ? 'person' : 'people'}
                    </Badge>
                  </CardTitle>
                  {role.description && (
                    <p className="text-sm text-muted-foreground">{role.description}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((group) => {
                      const inGroup = ALL_PERMISSIONS.filter(
                        (permission) => groupOf(permission) === group,
                      );
                      const grantedCount = inGroup.filter((permission) =>
                        held.has(permission),
                      ).length;
                      if (grantedCount === 0) return null;

                      const full = grantedCount === inGroup.length;
                      return (
                        <Badge key={group} variant={full ? 'success' : 'default'}>
                          {GROUP_LABELS[group] ?? group}
                          {!full && ` (${grantedCount}/${inGroup.length})`}
                        </Badge>
                      );
                    })}
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {role.permissions.length} of {ALL_PERMISSIONS.length} permissions.
                    {role.code === 'OWNER' && ' The Owner role always holds every permission.'}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
