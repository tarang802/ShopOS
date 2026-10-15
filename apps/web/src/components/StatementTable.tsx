import { Link } from 'react-router-dom';
import { formatDate, formatMoney } from '@/lib/format';
import type { Statement } from '@/features/purchasing/purchasingApi';

/**
 * A statement of account: every entry in date order with a running balance, an
 * opening balance carried in from before the period, and a closing line - the page
 * an accountant asks for, laid out the way a ledger folio is.
 *
 * The two sides are named by the caller because they mean different things on a
 * customer's account (bills raise it, payments lower it) and a supplier's (goods
 * received raise it, payments and returns lower it).
 */

const LINKS: Record<string, (id: string) => string> = {
  invoice: (id) => `/sales/${id}`,
  'purchase-order': (id) => `/purchases/${id}`,
};

export function StatementTable({
  statement,
  raisesLabel,
  reducesLabel,
}: {
  statement: Statement;
  raisesLabel: string;
  reducesLabel: string;
}) {
  const head = 'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider';

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={`${head} text-left`}>Date</th>
            <th className={`${head} text-left`}>Reference</th>
            <th className={`${head} text-left`}>Particulars</th>
            <th className={`${head} text-right`}>{raisesLabel}</th>
            <th className={`${head} text-right`}>{reducesLabel}</th>
            <th className={`${head} text-right`}>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-medium text-muted-foreground">
            <td className="px-3 py-2" colSpan={5}>
              Opening balance
            </td>
            <td className="px-3 py-2 text-right tabular">{formatMoney(statement.openingBalancePaise)}</td>
          </tr>

          {statement.entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                Nothing in this period.
              </td>
            </tr>
          )}

          {statement.entries.map((entry, index) => {
            const href = entry.link ? LINKS[entry.link.type]?.(entry.link.id) : undefined;
            return (
              <tr key={`${entry.reference}-${index}`} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(entry.date)}</td>
                <td className="px-3 py-2 tabular">
                  {href ? (
                    <Link to={href} className="font-medium hover:text-primary hover:underline">
                      {entry.reference}
                    </Link>
                  ) : (
                    entry.reference
                  )}
                </td>
                <td className="px-3 py-2">{entry.description}</td>
                <td className="px-3 py-2 text-right tabular">{entry.debitPaise > 0 ? formatMoney(entry.debitPaise) : ''}</td>
                <td className="px-3 py-2 text-right tabular">{entry.creditPaise > 0 ? formatMoney(entry.creditPaise) : ''}</td>
                <td className="px-3 py-2 text-right font-medium tabular">{formatMoney(entry.balancePaise)}</td>
              </tr>
            );
          })}

          <tr className="rule-double font-semibold">
            <td className="px-3 py-2.5" colSpan={3}>
              Totals and closing balance
            </td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(statement.totalDebitPaise)}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(statement.totalCreditPaise)}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(statement.closingBalancePaise)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
