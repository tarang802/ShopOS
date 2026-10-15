import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  QUOTATION_STATUSES,
  endOfDayInTimeZone,
  toSkip,
  type PaginationQuery,
  type QuotationStatus,
} from '@shopos/shared';
import { Organization, Quotation, type IQuotation } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { buildDocumentLines, toFrozenLine } from './documentTotals';
import {
  assertCounterPaymentAllowed,
  loadPresentedInvoice,
  persistInvoiceAndPay,
  prepareInvoiceFromLines,
  priceDocumentLines,
  type CounterPayment,
  type InvoiceLineInput,
} from './invoices.service';
import { createSalesOrderInSession, resolveParties } from './salesOrders.service';

/**
 * Quotations: an offer with a price and an expiry.
 *
 * A quotation moves no stock and no money, and its prices are frozen when it is
 * written - an offer honoured next week charges what was quoted, however the rate
 * card has moved. Converting it carries those frozen terms into a sales order or
 * straight into an invoice.
 *
 * "Expired" is not a state anyone sets. A quotation past its last day simply is
 * expired, so the status shown is worked out from the dates every time it is read.
 */

const DEFAULT_VALID_DAYS = 15;
const DAY_MS = 86_400_000;

export interface QuotationInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  /** How many days the offer stands. */
  validDays?: number;
  notes?: string;
  terms?: string;
  items: InvoiceLineInput[];
}

/** The status a quotation really has right now, dates considered. */
export function effectiveStatus(
  quotation: Pick<IQuotation, 'status' | 'validUntil'>,
  now: Date = new Date(),
): QuotationStatus {
  const live =
    quotation.status === QUOTATION_STATUSES.DRAFT || quotation.status === QUOTATION_STATUSES.SENT;
  if (live && quotation.validUntil.getTime() < now.getTime()) return QUOTATION_STATUSES.EXPIRED;
  return quotation.status;
}

function present<T extends Pick<IQuotation, 'status' | 'validUntil'>>(quotation: T) {
  return { ...quotation, status: effectiveStatus(quotation) };
}

async function validUntilFor(ctx: TenantContext, days: number): Promise<Date> {
  const organization = await Organization.findById(ctx.organizationId).select('timezone').lean();
  return endOfDayInTimeZone(
    new Date(Date.now() + days * DAY_MS),
    organization?.timezone ?? 'Asia/Kolkata',
  );
}

async function loadQuotation(ctx: TenantContext, id: Types.ObjectId) {
  const quotation = await Quotation.findOne({ ...orgFilter(ctx), _id: id });
  if (!quotation) throw AppError.notFound('Quotation');
  assertBranchAccess(ctx, quotation.branchId);
  return quotation;
}

function assertNotExpired(quotation: Pick<IQuotation, 'status' | 'validUntil'>): void {
  if (effectiveStatus(quotation) === QUOTATION_STATUSES.EXPIRED) {
    throw AppError.businessRule('This quotation has expired. Extend its validity first');
  }
}

export async function createQuotation(ctx: TenantContext, input: QuotationInput) {
  const [parties, lines, validUntil] = await Promise.all([
    resolveParties(ctx, input),
    priceDocumentLines(ctx, input.items),
    validUntilFor(ctx, input.validDays ?? DEFAULT_VALID_DAYS),
  ]);
  const totals = buildDocumentLines(lines);

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'QT', session);

    const [quotation] = await Quotation.create(
      [
        {
          ...orgFilter(ctx),
          ...parties,
          number,
          status: QUOTATION_STATUSES.DRAFT,
          validUntil,
          items: totals.items,
          discountPaise: totals.discountPaise,
          subtotalPaise: totals.subtotalPaise,
          taxPaise: totals.taxPaise,
          totalPaise: totals.totalPaise,
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.terms ? { terms: input.terms } : {}),
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      sessionOption(session),
    );
    if (!quotation) throw AppError.internal('Could not create the quotation');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.QUOTATION_CREATED,
        entityType: 'Quotation',
        entityId: quotation._id,
        entityLabel: number,
        branchId: quotation.branchId,
        after: {
          customerName: quotation.customerName,
          totalPaise: quotation.totalPaise,
          lines: quotation.items.length,
        },
      },
      session,
    );

    return present(quotation.toObject());
  });
}

/** Replace a draft quotation. Once sent, an offer stands as made. */
export async function updateQuotation(ctx: TenantContext, id: Types.ObjectId, input: QuotationInput) {
  const quotation = await loadQuotation(ctx, id);
  if (quotation.status !== QUOTATION_STATUSES.DRAFT) {
    throw AppError.businessRule('Only a draft quotation can be edited');
  }

  const [parties, lines, validUntil] = await Promise.all([
    resolveParties(ctx, input),
    priceDocumentLines(ctx, input.items),
    validUntilFor(ctx, input.validDays ?? DEFAULT_VALID_DAYS),
  ]);
  const totals = buildDocumentLines(lines);

  const updated = await Quotation.findOneAndUpdate(
    { ...orgFilter(ctx), _id: id, status: QUOTATION_STATUSES.DRAFT },
    {
      $set: {
        ...parties,
        validUntil,
        items: totals.items,
        discountPaise: totals.discountPaise,
        subtotalPaise: totals.subtotalPaise,
        taxPaise: totals.taxPaise,
        totalPaise: totals.totalPaise,
        notes: input.notes,
        terms: input.terms,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw AppError.conflict('This quotation was just changed by someone else');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.QUOTATION_UPDATED,
    entityType: 'Quotation',
    entityId: updated._id,
    entityLabel: updated.number,
    branchId: updated.branchId,
    after: { totalPaise: updated.totalPaise },
  });

  return present(updated);
}

type Transition = 'send' | 'accept' | 'reject';

const TRANSITIONS: Record<Transition, { from: QuotationStatus[]; to: QuotationStatus }> = {
  send: { from: [QUOTATION_STATUSES.DRAFT], to: QUOTATION_STATUSES.SENT },
  accept: {
    from: [QUOTATION_STATUSES.DRAFT, QUOTATION_STATUSES.SENT],
    to: QUOTATION_STATUSES.ACCEPTED,
  },
  reject: {
    from: [QUOTATION_STATUSES.DRAFT, QUOTATION_STATUSES.SENT, QUOTATION_STATUSES.ACCEPTED],
    to: QUOTATION_STATUSES.REJECTED,
  },
};

export async function transitionQuotation(ctx: TenantContext, id: Types.ObjectId, action: Transition) {
  const quotation = await loadQuotation(ctx, id);
  const rule = TRANSITIONS[action];

  // Rejecting an offer that has lapsed is still allowed - it tidies a dead offer
  // away. Every other step needs the offer to still stand.
  if (action !== 'reject') assertNotExpired(quotation);

  const updated = await Quotation.findOneAndUpdate(
    { ...orgFilter(ctx), _id: id, status: { $in: rule.from } },
    { $set: { status: rule.to } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    throw AppError.businessRule(
      `A ${quotation.status.toLowerCase()} quotation cannot be ${rule.to.toLowerCase()}`,
    );
  }

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.QUOTATION_STATUS_CHANGED,
    entityType: 'Quotation',
    entityId: updated._id,
    entityLabel: updated.number,
    branchId: updated.branchId,
    before: { status: quotation.status },
    after: { status: updated.status },
  });

  return present(updated);
}

/** Give an offer more time. Works on a lapsed offer, which is the point of it. */
export async function extendQuotation(ctx: TenantContext, id: Types.ObjectId, days: number) {
  await loadQuotation(ctx, id);
  const validUntil = await validUntilFor(ctx, days);

  const updated = await Quotation.findOneAndUpdate(
    {
      ...orgFilter(ctx),
      _id: id,
      status: { $in: [QUOTATION_STATUSES.DRAFT, QUOTATION_STATUSES.SENT] },
    },
    { $set: { validUntil } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw AppError.businessRule('Only a draft or sent quotation can be extended');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.QUOTATION_UPDATED,
    entityType: 'Quotation',
    entityId: updated._id,
    entityLabel: updated.number,
    branchId: updated.branchId,
    after: { validUntil },
  });

  return present(updated);
}

const CONVERTIBLE: QuotationStatus[] = [
  QUOTATION_STATUSES.DRAFT,
  QUOTATION_STATUSES.SENT,
  QUOTATION_STATUSES.ACCEPTED,
];

/** Mark a quotation converted, only if nobody converted it first. */
async function claimForConversion(
  ctx: TenantContext,
  quotation: IQuotation & { _id: Types.ObjectId },
  target: NonNullable<IQuotation['convertedTo']>,
  session: Parameters<typeof sessionOption>[0],
): Promise<void> {
  const claimed = await Quotation.updateOne(
    { ...orgFilter(ctx), _id: quotation._id, status: { $in: CONVERTIBLE } },
    { $set: { status: QUOTATION_STATUSES.CONVERTED, convertedTo: target } },
    sessionOption(session),
  );
  if (claimed.matchedCount === 0) {
    throw AppError.conflict('This quotation was just converted by someone else');
  }

  await recordAudit(
    ctx,
    {
      action: AUDIT_ACTIONS.QUOTATION_CONVERTED,
      entityType: 'Quotation',
      entityId: quotation._id,
      entityLabel: quotation.number,
      branchId: quotation.branchId,
      after: { to: target.type, number: target.number },
    },
    session,
  );
}

export async function convertToSalesOrder(ctx: TenantContext, id: Types.ObjectId) {
  const quotation = await loadQuotation(ctx, id);
  assertNotExpired(quotation);
  if (!CONVERTIBLE.includes(quotation.status)) {
    throw AppError.businessRule(`A ${quotation.status.toLowerCase()} quotation cannot be converted`);
  }

  const order = await withTransaction(async (session) => {
    const created = await createSalesOrderInSession(
      ctx,
      {
        branchId: quotation.branchId.toString(),
        ...(quotation.customerId ? { customerId: quotation.customerId.toString() } : {}),
        customerName: quotation.customerName,
        ...(quotation.notes ? { notes: quotation.notes } : {}),
      },
      quotation.items.map((line) => toFrozenLine(line)),
      { quotationId: quotation._id, quotationNumber: quotation.number },
      session,
    );

    await claimForConversion(
      ctx,
      quotation.toObject(),
      { type: 'SALES_ORDER', id: created._id, number: created.number },
      session,
    );
    return created;
  });

  return order.toObject();
}

export interface ConvertToInvoiceInput {
  creditDays?: number;
  payment?: CounterPayment;
}

/** Bill a quotation straight away at the prices it was written with. */
export async function convertToInvoice(
  ctx: TenantContext,
  id: Types.ObjectId,
  input: ConvertToInvoiceInput,
) {
  const quotation = await loadQuotation(ctx, id);
  assertNotExpired(quotation);
  if (!CONVERTIBLE.includes(quotation.status)) {
    throw AppError.businessRule(`A ${quotation.status.toLowerCase()} quotation cannot be converted`);
  }

  const prepared = await prepareInvoiceFromLines(
    ctx,
    {
      branchId: quotation.branchId.toString(),
      ...(quotation.customerId ? { customerId: quotation.customerId.toString() } : {}),
      customerName: quotation.customerName,
      ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
      ...(quotation.notes ? { notes: quotation.notes } : {}),
    },
    quotation.items.map((line) => toFrozenLine(line)),
  );
  assertCounterPaymentAllowed(ctx, input.payment, prepared.totalPaise);

  const invoice = await withTransaction(async (session) => {
    const created = await persistInvoiceAndPay(ctx, prepared, input.payment, session);
    await claimForConversion(
      ctx,
      quotation.toObject(),
      { type: 'INVOICE', id: created._id, number: created.number },
      session,
    );
    return created;
  });

  return loadPresentedInvoice(ctx, invoice._id);
}

export interface QuotationListFilters {
  branchId?: string;
  status?: string;
  customerId?: string;
  q?: string;
}

export async function listQuotations(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: QuotationListFilters,
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.branchId = branchId;
  } else if (!ctx.allBranches) {
    filter.branchId = { $in: ctx.branchIds };
  }
  if (filters.customerId) filter.customerId = new Types.ObjectId(filters.customerId);
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { customerName: pattern }];
  }

  // EXPIRED is not stored, so filtering by it means "still draft or sent, and past
  // its last day". Every other status is a plain match, with lapsed offers taken
  // out of DRAFT and SENT so a lapsed offer is not listed as live.
  const now = new Date();
  if (filters.status === QUOTATION_STATUSES.EXPIRED) {
    filter.status = { $in: [QUOTATION_STATUSES.DRAFT, QUOTATION_STATUSES.SENT] };
    filter.validUntil = { $lt: now };
  } else if (
    filters.status === QUOTATION_STATUSES.DRAFT ||
    filters.status === QUOTATION_STATUSES.SENT
  ) {
    filter.status = filters.status;
    filter.validUntil = { $gte: now };
  } else if (filters.status) {
    filter.status = filters.status;
  }

  const [items, total] = await Promise.all([
    Quotation.find(filter)
      .sort({ quotationDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    Quotation.countDocuments(filter),
  ]);

  return { items: items.map(present), total, page: query.page, limit: query.limit };
}

export async function getQuotation(ctx: TenantContext, id: Types.ObjectId) {
  const quotation = await Quotation.findOne({ ...orgFilter(ctx), _id: id }).lean();
  if (!quotation) throw AppError.notFound('Quotation');
  assertBranchAccess(ctx, quotation.branchId);
  return present(quotation);
}
