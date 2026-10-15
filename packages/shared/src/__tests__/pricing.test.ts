import { describe, expect, it } from 'vitest';
import { formatTierRange, resolveTier, resolveUnitPrice, validateTiers, type PriceTier } from '../pricing';

const CARD: PriceTier[] = [
  { minQuantity: 1, maxQuantity: 9, pricePaise: 500 },
  { minQuantity: 10, maxQuantity: 49, pricePaise: 480 },
  { minQuantity: 50, maxQuantity: 99, pricePaise: 450 },
  { minQuantity: 100, maxQuantity: null, pricePaise: 420 },
];

describe('resolving a rate', () => {
  it.each([
    [1, 500],
    [9, 500],
    [10, 480],
    [49, 480],
    [50, 450],
    [99, 450],
    [100, 420],
    [5000, 420],
  ])('prices a quantity of %i at %i paise, at both edges of every slab', (quantity, expected) => {
    expect(resolveUnitPrice(CARD, quantity)).toBe(expected);
  });

  it('never invents a price for a quantity nothing covers', () => {
    expect(resolveUnitPrice(CARD, 0)).toBeNull();
    expect(resolveUnitPrice(CARD, -3)).toBeNull();
    expect(resolveUnitPrice(CARD, Number.NaN)).toBeNull();
    expect(resolveTier([{ minQuantity: 1, maxQuantity: 9, pricePaise: 500 }], 10)).toBeNull();
  });

  it('does not depend on the order the slabs were entered in', () => {
    expect(resolveUnitPrice([...CARD].reverse(), 50)).toBe(450);
  });

  it('labels slabs the way people say them', () => {
    expect(formatTierRange(CARD[0]!)).toBe('1 - 9');
    expect(formatTierRange(CARD[3]!)).toBe('100+');
  });
});

describe('validating a rate card', () => {
  it('accepts a clean card', () => {
    expect(validateTiers(CARD)).toEqual({ valid: true, issues: [] });
  });

  it('refuses an empty card', () => {
    expect(validateTiers([]).valid).toBe(false);
  });

  it('refuses a card that does not start at 1, leaving small quantities unpriced', () => {
    const result = validateTiers([{ minQuantity: 5, maxQuantity: null, pricePaise: 500 }]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('start at quantity 1');
  });

  it('refuses overlapping slabs, since two rates for one quantity is a guess', () => {
    const result = validateTiers([
      { minQuantity: 1, maxQuantity: 10, pricePaise: 500 },
      { minQuantity: 5, maxQuantity: null, pricePaise: 480 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('overlaps'))).toBe(true);
  });

  it('refuses a gap between slabs and names the unpriced quantities', () => {
    const result = validateTiers([
      { minQuantity: 1, maxQuantity: 10, pricePaise: 500 },
      { minQuantity: 20, maxQuantity: null, pricePaise: 480 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('11 to 19'))).toBe(true);
  });

  it('allows only the last slab to be open-ended', () => {
    const result = validateTiers([
      { minQuantity: 1, maxQuantity: null, pricePaise: 500 },
      { minQuantity: 10, maxQuantity: null, pricePaise: 480 },
    ]);
    expect(result.valid).toBe(false);
  });

  it('refuses fractional or negative rates', () => {
    expect(validateTiers([{ minQuantity: 1, maxQuantity: null, pricePaise: 4.5 }]).valid).toBe(false);
    expect(validateTiers([{ minQuantity: 1, maxQuantity: null, pricePaise: -1 }]).valid).toBe(false);
  });
});
