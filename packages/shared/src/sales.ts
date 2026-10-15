import { INVOICE_STATUSES, type InvoiceStatus } from './enums';
import { multiplyPaise, percentOfPaise, type Paise } from './money';

/**
 * Sales arithmetic shared by the API and the web app.
 *
 * Kept as pure functions for the same reason as the pricing rules: the browser
 * previews a bill with exactly the code the server uses to decide it, so a total
 * on screen can never differ from the total that gets saved.
 */

export interface LineAmountsInput {
  unitPricePaise: Paise;
  quantity: number;
  /** 0 to 100. A discount is taken off the gross amount before tax is added. */
  discountPercent?: number;
  taxRatePercent: number;
}

export interface LineAmounts {
  /** quantity x unit price, before any discount. */
  grossPaise: Paise;
  discountPaise: Paise;
  /** What tax is charged on: gross less discount. */
  subtotalPaise: Paise;
  taxPaise: Paise;
  lineTotalPaise: Paise;
}

/**
 * Work out one document line.
 *
 * Tax is charged on the discounted amount, not the gross one - a customer who
 * gets 10% off pays tax on the reduced figure. Each step rounds to whole paise,
 * so document totals are sums of exact integers and never drift.
 */
export function computeLineAmounts(input: LineAmountsInput): LineAmounts {
  const grossPaise = multiplyPaise(input.unitPricePaise, input.quantity);
  const discountPaise = percentOfPaise(grossPaise, input.discountPercent ?? 0);
  const subtotalPaise = grossPaise - discountPaise;
  const taxPaise = percentOfPaise(subtotalPaise, input.taxRatePercent);

  return {
    grossPaise,
    discountPaise,
    subtotalPaise,
    taxPaise,
    lineTotalPaise: subtotalPaise + taxPaise,
  };
}

/**
 * `part / whole` of an amount, rounded to whole paise.
 *
 * Used when a return gives back some of a line. Callers work out each return as
 * the difference between the cumulative amount after it and before it, so the
 * pieces always add up to exactly the original total - a line returned in three
 * parts never ends a paisa short or over.
 */
export function proportionalPaise(total: Paise, part: number, whole: number): Paise {
  if (whole <= 0) return 0;
  const raw = (total * part) / whole;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

export interface InvoiceAmounts {
  totalPaise: Paise;
  paidPaise: Paise;
  /** Value of goods the customer has sent back, credited against the bill. */
  returnedPaise?: Paise;
  /** Cash handed back to the customer for overpayment after a return. */
  refundedPaise?: Paise;
}

function netBill(invoice: InvoiceAmounts): Paise {
  return invoice.totalPaise - (invoice.returnedPaise ?? 0);
}

function netPaid(invoice: InvoiceAmounts): Paise {
  return invoice.paidPaise - (invoice.refundedPaise ?? 0);
}

/** What the customer still owes on this invoice. Never negative. */
export function invoiceOutstandingPaise(invoice: InvoiceAmounts): Paise {
  return Math.max(0, netBill(invoice) - netPaid(invoice));
}

/**
 * What the business is holding that belongs to the customer: they paid, then
 * returned goods, and the payment now exceeds the reduced bill.
 */
export function invoiceRefundDuePaise(invoice: InvoiceAmounts): Paise {
  return Math.max(0, netPaid(invoice) - netBill(invoice));
}

/**
 * The status an invoice should have, derived from its amounts.
 *
 * Status is never set by hand outside cancellation - it follows the money, which
 * is what keeps "paid" from meaning different things on different screens.
 */
export function deriveInvoiceStatus(invoice: InvoiceAmounts & { cancelled?: boolean }): InvoiceStatus {
  if (invoice.cancelled) return INVOICE_STATUSES.CANCELLED;
  if (invoice.totalPaise > 0 && (invoice.returnedPaise ?? 0) >= invoice.totalPaise) {
    return INVOICE_STATUSES.RETURNED;
  }
  if (invoiceOutstandingPaise(invoice) === 0) return INVOICE_STATUSES.PAID;
  if (netPaid(invoice) > 0) return INVOICE_STATUSES.PARTIALLY_PAID;
  return INVOICE_STATUSES.ISSUED;
}

/**
 * Days an amount is overdue as of `now`. Zero when not yet due.
 *
 * Rounded up: due dates run to the end of their day, so the morning after the due
 * date it is one day overdue, not zero. Rounding down would report an amount that
 * fell due last night as not late at all.
 */
export function daysOverdue(dueDate: Date | string, now: Date = new Date()): number {
  const due = new Date(dueDate).getTime();
  const diff = now.getTime() - due;
  return diff > 0 ? Math.ceil(diff / 86_400_000) : 0;
}

/** Aging buckets used by the receivables and payables reports. */
export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: Date | string, now: Date = new Date()): AgingBucket {
  const days = daysOverdue(dueDate, now);
  if (days === 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
}

/**
 * The last instant of the calendar day that `date` falls on, in a given timezone.
 *
 * A due date is a day, not a moment. An invoice due "today" is not late until
 * today is over, so due dates are stored as the end of their day in the
 * business's own timezone - otherwise a same-day bill turns overdue the second
 * after it is written.
 */
export function endOfDayInTimeZone(date: Date, timeZone: string): Date {
  const parts = (instant: Date) => {
    const fields = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const read = (type: string) => Number(fields.find((field) => field.type === type)?.value);
    return {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour'),
      minute: read('minute'),
      second: read('second'),
    };
  };

  const local = parts(date);
  const wallClockAsUtc = Date.UTC(local.year, local.month - 1, local.day, 23, 59, 59, 999);

  // How far the timezone sits from UTC at that moment, found by asking what the
  // wall clock reads there and comparing it with the UTC reading.
  const probe = parts(new Date(wallClockAsUtc));
  const probeAsUtc = Date.UTC(
    probe.year,
    probe.month - 1,
    probe.day,
    probe.hour,
    probe.minute,
    probe.second,
    999,
  );
  const offset = probeAsUtc - wallClockAsUtc;

  return new Date(wallClockAsUtc - offset);
}

/** The first instant of the calendar day that `date` falls on, in a given timezone. */
export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  // The end of the previous day, plus a millisecond, is the start of this one.
  const yesterday = new Date(date.getTime() - 86_400_000);
  return new Date(endOfDayInTimeZone(yesterday, timeZone).getTime() + 1);
}

/**
 * Turn a date-only range (the 1st to the 31st) into the real instants it covers in
 * the business's timezone.
 *
 * A date typed or sent as `2026-10-01` arrives as midnight UTC, which in India is
 * already 5:30am. Treating it as an instant would drop the early hours of the first
 * day and add the early hours of the day after the last. Reading it as a calendar
 * date, and asking where that day starts and ends locally, avoids both.
 */
export function calendarRange(
  from: Date | undefined,
  to: Date | undefined,
  timeZone: string,
): { from: Date | undefined; to: Date | undefined } {
  // Noon UTC sits inside the same calendar day in every timezone that matters here.
  const noon = (date: Date) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));

  return {
    from: from ? startOfDayInTimeZone(noon(from), timeZone) : undefined,
    to: to ? endOfDayInTimeZone(noon(to), timeZone) : undefined,
  };
}
