import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { MEMBERSHIP_STATUSES, PERMISSIONS } from '@shopos/shared';
import { api, ApiRequestError, toQuery, type PaginatedResult } from '@/lib/apiClient';
import { useHasPermission } from '@/stores/authStore';
import { useBranches } from '@/hooks/useBranches';
import { LABELS } from '@/lib/labels';
import { formatRelative } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

/**
 * Staff.
 *
 * A staff member is really a membership - the join between a person and this
 * business - which is what lets one accountant serve two shops and gives branch
 * scoping somewhere to live.
 *
 * Accounts are created with a password handed over directly rather than by email
 * invitation, because email is not wired up yet and because a shop owner adding
 * an employee is usually standing next to them.
 */

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  roleName: string;
  allBranches: boolean;
  branches: { id: string; name: string }[];
  status: string;
  lastLoginAt?: string;
}

interface Role {
  _id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  memberCount: number;
}

function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => api.list<Member>(`/users${toQuery({ limit: 100 })}`),
    select: (result: PaginatedResult<Member>) => result.items,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/roles'),
    staleTime: 60_000,
  });
}

function AddStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const { data: roles } = useRoles();
  const { data: branches } = useBranches();

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    roleId: '',
    allBranches: false,
    branchIds: [] as string[],
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      name: '',
      email: '',
      password: '',
      phone: '',
      roleId: '',
      allBranches: false,
      branchIds: [],
    });
  }, [open]);

  const create = useMutation({
    mutationFn: (body: typeof form) => api.post('/users', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['members'] });
      onOpenChange(false);
    },
    onError: (cause) =>
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not add the staff member'),
  });

  const ready =
    form.name.trim() &&
    form.email.trim() &&
    form.password.length >= 10 &&
    form.roleId &&
    (form.allBranches || form.branchIds.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add staff member"
      description="स्टाफ जोड़ें"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate(form)} disabled={!ready || create.isPending}>
            {create.isPending ? 'Adding...' : 'Add staff member'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            autoFocus
          />
        </Field>
        <Field label="Mobile number">
          <Input
            value={form.phone}
            onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))}
          />
        </Field>
        <Field label="Email" required hint="They sign in with this">
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
          />
        </Field>
        <Field label="Password" required hint="At least 10 characters. Share it with them">
          <Input
            type="text"
            value={form.password}
            onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
          />
        </Field>
      </div>

      <Field label="Role" required hint="What they are allowed to do">
        <Select
          value={form.roleId}
          onChange={(event) => setForm((c) => ({ ...c, roleId: event.target.value }))}
        >
          <option value="">Select a role</option>
          {roles?.map((role) => (
            <option key={role._id} value={role._id}>
              {role.name}
              {role.description ? ` - ${role.description}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Branches" required hint="Which locations they work at">
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={form.allBranches}
            onChange={(event) =>
              setForm((c) => ({ ...c, allBranches: event.target.checked, branchIds: [] }))
            }
          />
          All branches, including any added later
        </label>

        {!form.allBranches && (
          <div className="space-y-1.5 rounded-md border border-border p-3">
            {branches?.map((branch) => (
              <label key={branch._id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={form.branchIds.includes(branch._id)}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      branchIds: event.target.checked
                        ? [...c.branchIds, branch._id]
                        : c.branchIds.filter((id) => id !== branch._id),
                    }))
                  }
                />
                {branch.name}
              </label>
            ))}
          </div>
        )}
      </Field>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function StaffPage() {
  const canManage = useHasPermission(PERMISSIONS.USERS_MANAGE);
  const client = useQueryClient();
  const { data: members, isPending } = useMembers();
  const { data: roles } = useRoles();
  const [addOpen, setAddOpen] = useState(false);

  const updateMember = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/users/${id}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['members'] }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <LabelledPageHeader
        label={LABELS.staff}
        description="Who can sign in, and what each person is allowed to do"
        actions={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add staff
            </Button>
          ) : undefined
        }
      />

      {isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading staff...</p>
      ) : !members || members.length === 0 ? (
        <EmptyState icon={Users} title="No staff yet" message="Add the people who work with you." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Branches</TH>
              <TH>Last signed in</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {members.map((member) => (
              <TR key={member.membershipId}>
                <TD>
                  <span className="block font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">{member.email}</span>
                </TD>
                <TD>
                  {canManage ? (
                    <Select
                      className="h-8 w-40"
                      value={member.roleId}
                      onChange={(event) =>
                        updateMember.mutate({
                          id: member.membershipId,
                          body: { roleId: event.target.value },
                        })
                      }
                    >
                      {roles?.map((role) => (
                        <option key={role._id} value={role._id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    member.roleName
                  )}
                </TD>
                <TD className="text-muted-foreground">
                  {member.allBranches
                    ? 'All branches'
                    : member.branches.map((branch) => branch.name).join(', ') || '-'}
                </TD>
                <TD className="text-muted-foreground">{formatRelative(member.lastLoginAt)}</TD>
                <TD>
                  {canManage ? (
                    <Select
                      className="h-8 w-32"
                      value={member.status}
                      onChange={(event) =>
                        updateMember.mutate({
                          id: member.membershipId,
                          body: { status: event.target.value },
                        })
                      }
                    >
                      <option value={MEMBERSHIP_STATUSES.ACTIVE}>Active</option>
                      <option value={MEMBERSHIP_STATUSES.SUSPENDED}>Suspended</option>
                    </Select>
                  ) : (
                    <Badge
                      variant={member.status === MEMBERSHIP_STATUSES.ACTIVE ? 'success' : 'outline'}
                    >
                      {member.status}
                    </Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <AddStaffDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
