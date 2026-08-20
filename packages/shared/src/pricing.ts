import type { Paise } from './money';

/**
 * The ShopOS pricing engine.
 *
 * WHAT: given a set of quantity tiers and a quantity, return exactly one rate.
 *
 * WHY it lives in `shared`: the rules must be identical on both sides. The
 * backend runs them to decide the authoritative price; the web app runs the same
 * functions only to preview a rate card as the owner types it. If these were two
 * implementations they would eventually disagree, and the owner would see one
 * rate on screen and another on the bill.
 *
 * The backend result is always the one that is stored. The frontend never sends
 * a price it computed itself.
 *
 * HOW a rate card looks in an Indian shop:
 *
 *   1 - 9     Rs 5.00      (counter rate)
 *   10 - 49   Rs 4.80
 *   50 - 99   Rs 4.50
 *   100+      Rs 4.20      (open-ended top tier)
 */

export interface PriceTier {
  /** First quantity this rate applies to. Always 1 or more. */
  minQuantity: number;
  /** Last quantity this rate applies to. `null` means open-ended. */
  maxQuantity: number | null;
  /** Rate per unit, in paise. */
  pricePaise: Paise;
}

export interface TierValidationIssue {
  index: number;
  message: string;
}

export interface TierValidationResult {
  valid: boolean;
  issues: TierValidationIssue[];
}

/** Sort a copy of the tiers by starting quantity. Never mutates the input. */
export function sortTiers(tiers: readonly PriceTier[]): PriceTier[] {
  return [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
}

/**
 * Validate a complete rate card.
 *
 * The rules exist so that pricing is *deterministic*: for any quantity there is
 * exactly one applicable tier, never two and never none.
 *
 *   1. At least one tier.
 *   2. The card starts at quantity 1, so no quantity is unpriced.
 *   3. Quantities are whole numbers of 1 or more.
 *   4. A tier ends at or after it starts.
 *   5. Tiers do not overlap - two rates for quantity 10 is not a price, it is a
 *      guess.
 *   6. Tiers leave no gap - each starts exactly where the previous ended plus 1.
 *   7. Only the final tier may be open-ended (the `100+` row).
 *   8. Rates are whole paise and never negative.
 */
export function validateTiers(tiers: readonly PriceTier[]): TierValidationResult {
  const issues: TierValidationIssue[] = [];

  if (tiers.length === 0) {
    return { valid: false, issues: [{ index: -1, message: 'Add at least one quantity slab' }] };
  }

  const sorted = sortTiers(tiers);

  sorted.forEach((tier, index) => {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 1) {
      issues.push({ index, message: 'From-quantity must be a whole number of 1 or more' });
    }
    if (tier.maxQuantity !== null) {
      if (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < 1) {
        issues.push({ index, message: 'To-quantity must be a whole number of 1 or more' });
      } else if (tier.maxQuantity < tier.minQuantity) {
        issues.push({ index, message: 'To-quantity cannot be less than from-quantity' });
      }
    }
    if (!Number.isInteger(tier.pricePaise) || tier.pricePaise < 0) {
      issues.push({ index, message: 'Rate must be a valid amount' });
    }
    // Only the last row may be left open-ended.
    if (tier.maxQuantity === null && index !== sorted.length - 1) {
      issues.push({ index, message: 'Only the last slab can be left open-ended' });
    }
  });

  const first = sorted[0];
  if (first && first.minQuantity !== 1) {
    issues.push({ index: 0, message: 'The first slab must start at quantity 1' });
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current || previous.maxQuantity === null) continue;

    if (current.minQuantity <= previous.maxQuantity) {
      issues.push({
        index,
        message: `Slab overlaps the previous one, which already covers up to ${previous.maxQuantity}`,
      });
    } else if (current.minQuantity > previous.maxQuantity + 1) {
      issues.push({
        index,
        message: `Quantities ${previous.maxQuantity + 1} to ${current.minQuantity - 1} have no rate`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Find the tier that applies to a quantity.
 *
 * Returns `null` when nothing matches, which the caller must surface as an
 * error. It must never quietly fall back to another rate - a wrong price that
 * looks confident is worse than an honest refusal to quote.
 */
export function resolveTier(tiers: readonly PriceTier[], quantity: number): PriceTier | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  for (const tier of sortTiers(tiers)) {
    const aboveFloor = quantity >= tier.minQuantity;
    const belowCeiling = tier.maxQuantity === null || quantity <= tier.maxQuantity;
    if (aboveFloor && belowCeiling) return tier;
  }

  return null;
}

/** The unit rate for a quantity, or null when no slab covers it. */
export function resolveUnitPrice(tiers: readonly PriceTier[], quantity: number): Paise | null {
  return resolveTier(tiers, quantity)?.pricePaise ?? null;
}

/** Human-readable slab label: "1 - 9", "100+". */
export function formatTierRange(tier: PriceTier): string {
  return tier.maxQuantity === null
    ? `${tier.minQuantity}+`
    : `${tier.minQuantity} - ${tier.maxQuantity}`;
}
