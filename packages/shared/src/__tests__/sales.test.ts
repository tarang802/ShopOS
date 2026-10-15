import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  calendarRange,
  computeLineAmounts,
  daysOverdue,
  deriveInvoiceStatus,
  endOfDayInTimeZone,
  invoiceOutstandingPaise,
  invoiceRefundDuePaise,
  proportionalPaise,
  startOfDayInTimeZone,
} from '../sales';
import { derivePayableStatus, purchaseCreditDuePaise, purchaseOwedPaise, purchasePayableCapPaise } from '../purchasing';

describe('a document line', () => {
  it('takes the discount off before charging tax on what is left', () => {
    expect(computeLineAmounts({ unitPricePaise: 420, quantity: 100, discountPercent: 5, taxRatePercent: 12 })).toEqual({
      grossPaise: 42000,
      discountPaise: 2100,
      subtotalPaise: 39900,
      taxPaise: 4788,
      lineTotalPaise: 44688,
    });
  });

  it('treats a missing discount as none', () => {
    const amounts = computeLineAmounts({ unitPricePaise: 1000, quantity: 3, taxRatePercent: 18 });
    expect(amounts.discountPaise).toBe(0);
    expect(amounts.lineTotalPaise).toBe(3540);
  });
});

describe('returning part of a line', () => {
  it('credits the pieces so they add up to the whole, whatever the rounding', () => {
    const total = 5376;
    const returns = [3, 2, 5];

    let before = 0;
    const credits = returns.map((quantity) => {
      const after = before + quantity;
      const credit = proportionalPaise(total, after, 10) - proportionalPaise(total, before, 10);
      before = after;
      return credit;
    });

    expect(credits).toEqual([1613, 1075, 2688]);
    expect(credits.reduce((sum, credit) => sum + credit, 0)).toBe(total);
  });

  it('adds up exactly for any split of an awkward total', () => {
    const total = 1001;
    for (const split of [[1, 1, 1], [2, 1], [3], [1, 2]]) {
      let before = 0;
      let sum = 0;
      for (const quantity of split) {
        sum += proportionalPaise(total, before + quantity, 3) - proportionalPaise(total, before, 3);
        before += quantity;
      }
      expect(sum).toBe(total);
    }
  });

  it('is zero when there is nothing to divide by', () => {
    expect(proportionalPaise(1000, 1, 0)).toBe(0);
  });
});

describe('what a customer owes', () => {
  const bill = { totalPaise: 10000, paidPaise: 0 };

  it('is the whole bill until something is paid or returned', () => {
    expect(invoiceOutstandingPaise(bill)).toBe(10000);
  });

  it('falls with payments and with returns', () => {
    expect(invoiceOutstandingPaise({ ...bill, paidPaise: 4000 })).toBe(6000);
    expect(invoiceOutstandingPaise({ ...bill, returnedPaise: 2500 })).toBe(7500);
  });

  it('is never negative, and an overpayment becomes money owed back', () => {
    const overpaid = { ...bill, paidPaise: 10000, returnedPaise: 4000 };
    expect(invoiceOutstandingPaise(overpaid)).toBe(0);
    expect(invoiceRefundDuePaise(overpaid)).toBe(4000);
    expect(invoiceRefundDuePaise({ ...overpaid, refundedPaise: 1500 })).toBe(2500);
  });
});

describe('invoice status', () => {
  const bill = { totalPaise: 10000, paidPaise: 0 };

  it('follows the money', () => {
    expect(deriveInvoiceStatus(bill)).toBe('ISSUED');
    expect(deriveInvoiceStatus({ ...bill, paidPaise: 1 })).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...bill, paidPaise: 10000 })).toBe('PAID');
  });

  it('is RETURNED once everything has come back, and CANCELLED overrides all', () => {
    expect(deriveInvoiceStatus({ ...bill, returnedPaise: 10000 })).toBe('RETURNED');
    expect(deriveInvoiceStatus({ ...bill, paidPaise: 10000, cancelled: true })).toBe('CANCELLED');
  });

  it('calls a returned-and-refunded bill returned rather than paid', () => {
    expect(deriveInvoiceStatus({ totalPaise: 10000, paidPaise: 10000, returnedPaise: 10000, refundedPaise: 10000 })).toBe('RETURNED');
  });
});

describe('being late', () => {
  const dueAtEndOfDay = new Date('2026-10-10T18:29:59.999Z'); // 23:59:59 IST on the 10th

  it('is zero until the due day is over', () => {
    expect(daysOverdue(dueAtEndOfDay, new Date('2026-10-10T12:00:00Z'))).toBe(0);
  });

  it('is one day the morning after, rather than zero', () => {
    expect(daysOverdue(dueAtEndOfDay, new Date('2026-10-10T20:00:00Z'))).toBe(1);
    expect(daysOverdue(dueAtEndOfDay, new Date('2026-10-11T12:00:00Z'))).toBe(1);
    expect(daysOverdue(dueAtEndOfDay, new Date('2026-10-12T12:00:00Z'))).toBe(2);
  });

  it.each([
    [0, 'CURRENT'],
    [1, 'D1_30'],
    [30, 'D1_30'],
    [31, 'D31_60'],
    [60, 'D31_60'],
    [61, 'D61_90'],
    [90, 'D61_90'],
    [91, 'D90_PLUS'],
  ])('puts %i days late in the %s bucket', (days, bucket) => {
    const now = new Date('2026-12-31T12:00:00Z');
    // A due date `days` whole days before now, less a minute so ceil() lands on `days`.
    const due = days === 0 ? new Date(now.getTime() + 60_000) : new Date(now.getTime() - (days - 1) * 86_400_000 - 60_000);
    expect(agingBucket(due, now)).toBe(bucket);
  });
});

describe('the business calendar', () => {
  it('ends a due day at the last instant of that day in India, not in UTC', () => {
    // 15 Oct 2026, 14:00 UTC is 19:30 in Kolkata, still the 15th.
    const end = endOfDayInTimeZone(new Date('2026-10-15T14:00:00Z'), 'Asia/Kolkata');
    expect(end.toISOString()).toBe('2026-10-15T18:29:59.999Z');
  });

  it('starts the day at midnight Indian time, which is the evening before in UTC', () => {
    const start = startOfDayInTimeZone(new Date('2026-10-15T14:00:00Z'), 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });

  it('turns a date-only range into the real instants it covers, whole days at both ends', () => {
    const { from, to } = calendarRange(new Date('2026-10-01'), new Date('2026-10-31'), 'Asia/Kolkata');
    expect(from?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(to?.toISOString()).toBe('2026-10-31T18:29:59.999Z');
  });

  it('leaves an open end open', () => {
    expect(calendarRange(undefined, undefined, 'Asia/Kolkata')).toEqual({ from: undefined, to: undefined });
  });
});

describe('what is owed to a supplier', () => {
  const order = { totalPaise: 30000, receivedValuePaise: 18000, returnedPaise: 0, paidPaise: 0 };

  it('is what has been delivered, not what was ordered', () => {
    expect(purchaseOwedPaise(order)).toBe(18000);
    expect(purchaseOwedPaise({ totalPaise: 30000 })).toBe(0);
  });

  it('falls with payments and with goods sent back', () => {
    expect(purchaseOwedPaise({ ...order, paidPaise: 10000 })).toBe(8000);
    expect(purchaseOwedPaise({ ...order, returnedPaise: 3000 })).toBe(15000);
  });

  it('bounds what may still be paid by the order, allowing a deposit', () => {
    expect(purchasePayableCapPaise({ totalPaise: 30000 })).toBe(30000);
    expect(purchasePayableCapPaise({ ...order, paidPaise: 10000, returnedPaise: 5000 })).toBe(15000);
  });

  it('shows when a supplier has been paid more than the reduced order is worth', () => {
    expect(purchaseCreditDuePaise({ totalPaise: 30000, returnedPaise: 30000, paidPaise: 10000 })).toBe(10000);
    expect(purchaseOwedPaise({ ...order, returnedPaise: 18000, paidPaise: 10000 })).toBe(0);
  });

  it('derives the payment status', () => {
    expect(derivePayableStatus({ totalPaise: 100 })).toBe('UNPAID');
    expect(derivePayableStatus({ totalPaise: 100, paidPaise: 1 })).toBe('PARTIALLY_PAID');
    expect(derivePayableStatus({ totalPaise: 100, paidPaise: 100 })).toBe('PAID');
    expect(derivePayableStatus({ totalPaise: 100, returnedPaise: 100 })).toBe('PAID');
  });
});
