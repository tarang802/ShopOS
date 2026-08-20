import type { PaginationQuery } from '@shopos/shared';
import { AUDIT_ACTIONS } from '@shopos/shared';
import { Types } from 'mongoose';
import { Branch, InventoryBalance } from '../../db/models';
import { AppError } from '../../core/AppError';
import { paginate, safeSearchRegex } from '../../core/listQuery';
import { diffFields, recordAudit } from '../../services/auditService';
import { orgFilter, type TenantContext } from '../../core/tenantContext';

/**
 * Branches - the physical places that hold stock.
 *
 * Note what is NOT here: a delete. A branch is referenced by every stock
 * movement ever recorded against it, so removing it would orphan the history
 * that explains the current stock. Branches are deactivated instead, which hides
 * them from new work while leaving the past readable.
 */

export interface BranchInput {
  name: string;
  code: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export async function listBranches(ctx: TenantContext, query: PaginationQuery) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  // A branch manager sees only their own branches. Without this the branch list
  // would quietly reveal every location the business operates.
  if (!ctx.allBranches) {
    filter._id = { $in: ctx.branchIds };
  }

  if (query.search) {
    const pattern = safeSearchRegex(query.search);
    filter.$or = [{ name: pattern }, { code: pattern }, { city: pattern }];
  }

  return paginate({
    model: Branch,
    filter,
    query,
    sortableFields: ['name', 'code', 'createdAt'],
    defaultSort: { isMain: -1, name: 1 },
  });
}

export async function getBranch(ctx: TenantContext, branchId: Types.ObjectId) {
  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId }).lean();
  if (!branch) throw AppError.notFound('Branch');

  if (!ctx.allBranches && !ctx.branchIds.some((id) => id.equals(branchId))) {
    // Deliberately the same 404 as a branch that does not exist. Answering 403
    // would confirm that this branch is real, which is information about another
    // part of the business the caller has no right to.
    throw AppError.notFound('Branch');
  }

  return branch;
}

export async function createBranch(ctx: TenantContext, input: BranchInput) {
  const code = input.code.trim().toUpperCase();

  const existing = await Branch.findOne({ ...orgFilter(ctx), code }).lean();
  if (existing) throw AppError.duplicate(`Branch code ${code} is already in use`);

  const [branch] = await Branch.create([
    {
      ...orgFilter(ctx),
      ...input,
      code,
      isMain: false,
    },
  ]);
  if (!branch) throw AppError.internal('Could not create the branch');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.BRANCH_CREATED,
    entityType: 'Branch',
    entityId: branch._id,
    entityLabel: branch.name,
    after: { name: branch.name, code: branch.code, city: branch.city },
  });

  return branch.toObject();
}

export async function updateBranch(
  ctx: TenantContext,
  branchId: Types.ObjectId,
  input: Partial<BranchInput> & { isActive?: boolean },
) {
  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId });
  if (!branch) throw AppError.notFound('Branch');

  if (input.code) {
    const code = input.code.trim().toUpperCase();
    if (code !== branch.code) {
      const clash = await Branch.findOne({ ...orgFilter(ctx), code }).lean();
      if (clash) throw AppError.duplicate(`Branch code ${code} is already in use`);
    }
    input.code = code;
  }

  // The head branch must remain active. Deactivating it would leave a business
  // with nowhere to receive goods and no obvious way to recover.
  if (input.isActive === false && branch.isMain) {
    throw AppError.businessRule('The main branch cannot be deactivated');
  }

  if (input.isActive === false) {
    const stocked = await InventoryBalance.findOne({
      ...orgFilter(ctx),
      branchId,
      quantity: { $gt: 0 },
    }).lean();
    if (stocked) {
      throw AppError.businessRule(
        'This branch still holds stock. Transfer it out before deactivating the branch',
      );
    }
  }

  const before = branch.toObject();
  Object.assign(branch, input);
  await branch.save();

  const changes = diffFields(before, input as Record<string, unknown>);
  if (changes) {
    await recordAudit(ctx, {
      action: AUDIT_ACTIONS.BRANCH_UPDATED,
      entityType: 'Branch',
      entityId: branch._id,
      entityLabel: branch.name,
      ...changes,
    });
  }

  return branch.toObject();
}
