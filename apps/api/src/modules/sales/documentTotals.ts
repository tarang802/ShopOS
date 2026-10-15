import { computeLineAmounts, sumPaise } from '@shopos/shared';
import type { IDocumentLine } from '../../db/models';
import type { FrozenLine } from './invoices.service';

/**
 * Turn lines whose terms are settled into document lines with their amounts, and
 * add up the document.
 *
 * Used by quotations and sales orders, which both store exactly this: the rate,
 * discount and tax frozen when the price was committed, plus the arithmetic that
 * follows from them. It uses the same shared `computeLineAmounts` the invoice and
 * the web preview use, so a quote, the order made from it and the invoice made
 * from that always agree to the paisa.
 */
export function buildDocumentLines(lines: FrozenLine[]): {
  items: IDocumentLine[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
} {
  const items: IDocumentLine[] = lines.map((line) => ({
    ...line,
    ...computeLineAmounts({
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      discountPercent: line.discountPercent,
      taxRatePercent: line.taxRatePercent,
    }),
  }));

  const subtotalPaise = sumPaise(items.map((item) => item.subtotalPaise));
  const taxPaise = sumPaise(items.map((item) => item.taxPaise));

  return {
    items,
    discountPaise: sumPaise(items.map((item) => item.discountPaise)),
    subtotalPaise,
    taxPaise,
    totalPaise: subtotalPaise + taxPaise,
  };
}

/** A line carried from a stored document into a new one, terms untouched. */
export function toFrozenLine(line: IDocumentLine, quantity = line.quantity): FrozenLine {
  return {
    productId: line.productId,
    productName: line.productName,
    sku: line.sku,
    unitSymbol: line.unitSymbol,
    quantity,
    unitPricePaise: line.unitPricePaise,
    discountPercent: line.discountPercent,
    taxRatePercent: line.taxRatePercent,
  };
}
