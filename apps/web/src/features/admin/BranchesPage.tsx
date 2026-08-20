import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { api, ApiRequestError } from '@/lib/apiClient';
import { useHasPermission } from '@/stores/authStore';
import { useBranches, type Branch } from '@/hooks/useBranches';
import { LABELS } from '@/lib/labels';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

/**
 * Branches: the places that hold stock.
 *
 * There is no delete. Every stock movement ever recorded points at a branch, so
 * removing one would orphan the history that explains today's figures. A branch
 * that closes is deactivated, and the API refuses even that while it still holds
 * stock - transfer it out first, so the goods are accounted for rather than
 * disappearing with the branch.
 */

function BranchDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: Branch;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    code: '',
    phone: '',
    addressLine: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      name: existing?.name ?? '',
      code: existing?.code ?? '',
      phone: existing?.phone ?? '',
      addressLine: existing?.addressLine ?? '',
      city: existing?.city ?? '',
      state: existing?.state ?? '',
      pincode: existing?.pincode ?? '',
    });
  }, [open, existing]);

  const save = useMutation({
    mutationFn: (body: typeof form) =>
      existing ? api.patch(`/branches/${existing._id}`, body) : api.post('/branches', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['branches'] });
      onOpenChange(false);
    },
    onError: (cause) =>
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not save the branch'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Edit branch' : 'Add branch'}
      description={existing ? undefined : 'नई शाखा जोड़ें'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate(form)}
            disabled={!form.name.trim() || !form.code.trim() || save.isPending}
          >
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Branch name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            placeholder="Patna"
            autoFocus
          />
        </Field>
        <Field label="Short code" required hint="Used on documents">
          <Input
            value={form.code}
            onChange={(event) => setForm((c) => ({ ...c, code: event.target.value.toUpperCase() }))}
            placeholder="PAT"
            maxLength={12}
          />
        </Field>
        <Field label="Phone">
          <Input
            value={form.phone}
            onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))}
          />
        </Field>
        <Field label="City">
          <Input
            value={form.city}
            onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))}
          />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input
            value={form.addressLine}
            onChange={(event) => setForm((c) => ({ ...c, addressLine: event.target.value }))}
          />
        </Field>
        <Field label="State">
          <Input
            value={form.state}
            onChange={(event) => setForm((c) => ({ ...c, state: event.target.value }))}
          />
        </Field>
        <Field label="PIN code">
          <Input
            value={form.pincode}
            onChange={(event) => setForm((c) => ({ ...c, pincode: event.target.value }))}
            maxLength={10}
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function BranchesPage() {
  const canManage = useHasPermission(PERMISSIONS.BRANCHES_MANAGE);
  const { data: branches, isPending } = useBranches();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | undefined>();

  return (
    <div className="mx-auto max-w-4xl">
      <LabelledPageHeader
        label={LABELS.branches}
        description="Shops and godowns that hold your stock"
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add branch
            </Button>
          ) : undefined
        }
      />

      {isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading branches...</p>
      ) : !branches || branches.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No branches"
          message="Add the shops and godowns where you keep stock."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Branch</TH>
              <TH>Code</TH>
              <TH>City</TH>
              <TH>Phone</TH>
              <TH>Status</TH>
              {canManage && <TH />}
            </TR>
          </THead>
          <TBody>
            {branches.map((branch) => (
              <TR key={branch._id}>
                <TD className="font-medium">
                  {branch.name}
                  {branch.isMain && (
                    <Badge variant="outline" className="ml-2">
                      Main
                    </Badge>
                  )}
                </TD>
                <TD className="tabular text-muted-foreground">{branch.code}</TD>
                <TD>{branch.city ?? '-'}</TD>
                <TD className="tabular">{branch.phone ?? '-'}</TD>
                <TD>
                  <Badge variant={branch.isActive ? 'success' : 'outline'}>
                    {branch.isActive ? 'Active' : 'Closed'}
                  </Badge>
                </TD>
                {canManage && (
                  <TD>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(branch);
                        setDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <BranchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        {...(editing ? { existing: editing } : {})}
      />
    </div>
  );
}
