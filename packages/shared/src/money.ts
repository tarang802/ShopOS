/**
 * ShopOS money handling.
 *
 * WHAT: every monetary value in ShopOS is stored and transported as an integer
 * number of *paise* (the minor unit of the rupee). Rs 4.80 is stored as 480.
 *
 * WHY: binary floating point cannot represent 4.80 exactly. Adding thousands of
 * such values drifts by fractions of a paisa, and an accountant eventually finds
 * a total that is off by a rupee. Integers are exact, and JavaScript's safe
 * integer range covers roughly Rs 90 trillion, which is far beyond any shop.
 *
 * RULE: never do arithmetic on rupee floats. Convert at the edge (input parsing
 * and display formatting) and keep paise everywhere in between.
 */

/** A monetary amount expressed in paise. Always an integer. */
export type Paise = number;

export const PAISE_PER_RUPEE = 100;

/** Largest amount we accept, ~Rs 90,07,19,92,54,740 - guards against overflow. */
export const MAX_PAISE = Number.MAX_SAFE_INTEGER;

export function isValidPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_PAISE;
}

/**
 * Convert a rupee amount (as typed by a user) into paise.
 * Rounds half away from zero, which is what people expect when entering money.
 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new Error('Cannot convert a non-finite number to paise');
  }
  const scaled = rupees * PAISE_PER_RUPEE;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Convert paise back into a rupee number. Use only for display or export. */
export function paiseToRupees(paise: Paise): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Format paise for display, e.g. 480 -> "Rs 4.80".
 * The currency symbol is supplied by the caller so organizations on another
 * currency are not hard-coded to the rupee.
 */
export function formatPaise(paise: Paise, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

/**
 * Multiply a unit price by a quantity and return an integer paise result.
 *
 * Quantities may be fractional (2.5 kg), so the product may be fractional too.
 * We round half away from zero at the line level. Line totals are then summed
 * as exact integers, so document totals never drift.
 */
export function multiplyPaise(unitPrice: Paise, quantity: number): Paise {
  const raw = unitPrice * quantity;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/**
 * Apply a percentage (e.g. tax or discount) to a paise amount.
 * `percent` is a plain percentage: 18 means 18%.
 */
export function percentOfPaise(amount: Paise, percent: number): Paise {
  const raw = (amount * percent) / 100;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/** Sum a list of paise amounts. Exact, because every input is an integer. */
export function sumPaise(amounts: readonly Paise[]): Paise {
  return amounts.reduce<Paise>((total, amount) => total + amount, 0);
}
