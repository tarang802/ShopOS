import { formatMoney, formatNumber } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import type { DocumentLine } from './quotationsApi';

/**
 * The lines and totals of a quotation or sales order.
 *
 * Every figure is read from the document, never recalculated from today's rates:
 * a quotation honoured next week must still show what was quoted.
 */
export function DocumentLinesTable({
  items,
  totals,
  showInvoiced,
}: {
  items: DocumentLine[];
  totals: { discountPaise: number; subtotalPaise: number; taxPaise: number; totalPaise: number };
  showInvoiced?: boolean;
}) {
  const hasDiscount = items.some((item) => item.discountPaise > 0);
  const head = 'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <Card className="mb-6">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 print:bg-transparent">
              <tr>
                <th className={`${head} text-left`}>Product</th>
                <th className={`${head} text-right`}>Qty</th>
                {showInvoiced && <th className={`${head} text-right`}>Invoiced</th>}
                <th className={`${head} text-right`}>Rate</th>
                {hasDiscount && <th className={`${head} text-right`}>Discount</th>}
                <th className={`${head} text-right`}>Tax</th>
                <th className={`${head} text-right`}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{item.productName}</span>
                    <span className="text-xs text-muted-foreground tabular">{item.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatNumber(item.quantity)} {item.unitSymbol}
                  </td>
                  {showInvoiced && (
                    <td className="px-4 py-2.5 text-right tabular">
                      {item.invoicedQty && item.invoicedQty >= item.quantity ? (
                        <span className="text-success">{formatNumber(item.invoicedQty)}</span>
                      ) : (
                        formatNumber(item.invoicedQty ?? 0)
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(item.unitPricePaise)}</td>
                  {hasDiscount && (
                    <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                      {item.discountPercent > 0 ? `${item.discountPercent}%` : '-'}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{item.taxRatePercent}%</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-border p-4">
          <div className="w-64 space-y-1.5 text-sm">
            {totals.discountPaise > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount given</span>
                <span className="tabular">{formatMoney(totals.discountPaise)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular">{formatMoney(totals.subtotalPaise)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="tabular">{formatMoney(totals.taxPaise)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
              <span>Total</span>
              <span className="tabular">{formatMoney(totals.totalPaise)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
