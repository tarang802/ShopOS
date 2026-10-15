import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyShort, formatNumber, formatQuantity, paiseToInput, parseRupeeInput } from './format';
import { INVOICE_STATUS, statusOf } from './statusStyles';

describe('money for an Indian reader', () => {
  it('groups in lakhs and crores, not thousands', () => {
    expect(formatNumber(120000)).toBe('1,20,000');
    expect(formatNumber(12345678)).toBe('1,23,45,678');
    expect(formatMoney(12000000)).toContain('1,20,000.00');
  });

  it('shows paise on a figure and drops them on a headline', () => {
    expect(formatMoney(48000)).toContain('480.00');
    expect(formatMoneyShort(48050)).not.toContain('.');
  });

  it('prints a quantity with its unit and no pointless decimals', () => {
    expect(formatQuantity(1200, 'pcs')).toBe('1,200 pcs');
    expect(formatQuantity(2.5, 'kg')).toBe('2.5 kg');
    expect(formatQuantity(3.1, 'kg')).toBe('3.1 kg');
  });
});

describe('what people type into a rupee box', () => {
  it('reads plain and decorated amounts', () => {
    expect(parseRupeeInput('4.80')).toBe(480);
    expect(parseRupeeInput('Rs 1,200')).toBe(120000);
    expect(parseRupeeInput('12')).toBe(1200);
  });

  it('reads blanks and nonsense as zero rather than NaN', () => {
    expect(parseRupeeInput('')).toBe(0);
    expect(parseRupeeInput('abc')).toBe(0);
  });

  it('round-trips an amount back into a field', () => {
    expect(paiseToInput(48050)).toBe('480.50');
    expect(parseRupeeInput(paiseToInput(48050))).toBe(48050);
  });
});

describe('status wording', () => {
  it('has a label for every invoice status the server can send', () => {
    for (const status of ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'RETURNED', 'CANCELLED']) {
      expect(INVOICE_STATUS[status]?.label, status).toBeTruthy();
    }
  });

  it('falls back to the raw status rather than breaking on one it does not know', () => {
    expect(statusOf(INVOICE_STATUS, 'SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', variant: 'outline' });
  });
});
