import { describe, expect, it } from 'vitest';
import {
  multiplyPaise,
  paiseToRupees,
  percentOfPaise,
  rupeesToPaise,
  sumPaise,
} from '../money';

describe('money', () => {
  it('stores rupees as whole paise, rounding half away from zero', () => {
    expect(rupeesToPaise(4.8)).toBe(480);
    expect(rupeesToPaise(0.005)).toBe(1);
    expect(rupeesToPaise(-0.005)).toBe(-1);
    expect(paiseToRupees(480)).toBe(4.8);
  });

  it('refuses a non-finite amount rather than storing nonsense', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow();
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('sums exactly where floating point would drift', () => {
    // 0.1 + 0.2 is the classic example; in paise there is nothing to drift.
    expect(sumPaise([10, 20])).toBe(30);
    expect(sumPaise(Array.from({ length: 1000 }, () => 1))).toBe(1000);
    expect(sumPaise([])).toBe(0);
  });

  it('rounds a line to whole paise, including fractional quantities', () => {
    expect(multiplyPaise(480, 10)).toBe(4800);
    expect(multiplyPaise(333, 2.5)).toBe(833); // 832.5 rounds up
    expect(multiplyPaise(100, 0.333)).toBe(33);
  });

  it('takes a percentage of an amount', () => {
    expect(percentOfPaise(39900, 12)).toBe(4788);
    expect(percentOfPaise(1000, 0)).toBe(0);
    expect(percentOfPaise(1, 50)).toBe(1); // 0.5 rounds up
  });
});
