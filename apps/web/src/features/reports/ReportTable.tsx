import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReportColumn, ReportResult, ReportRow } from './reportsApi';

/**
 * Renders any report from its description.
 *
 * A report arrives as named, typed columns and rows, so this one component draws
 * all of them - money in rupees with lakh grouping, percentages, dates - and a new
 * report needs no new screen.
 */

function cell(value: ReportRow[string] | undefined, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '';
  switch (column.type) {
    case 'money':
      return typeof value === 'number' ? formatMoney(value) : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value.toFixed(1)}%` : String(value);
    case 'number':
      return typeof value === 'number' ? formatNumber(value) : String(value);
    case 'date':
      return formatDate(String(value));
    default:
      return String(value);
  }
}

export function ReportTable({ report }: { report: ReportResult }) {
  const head = 'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider';
  const numeric = (column: ReportColumn) => column.type !== 'text' && column.type !== 'date';

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {report.columns.map((column) => (
                <th key={column.key} className={cn(head, numeric(column) ? 'text-right' : 'text-left')}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={report.columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  Nothing to report for this selection.
                </td>
              </tr>
            )}

            {report.rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {report.columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2', numeric(column) ? 'text-right tabular' : 'text-left')}>
                    {cell(row[column.key], column)}
                  </td>
                ))}
              </tr>
            ))}

            {report.totals && report.rows.length > 0 && (
              <tr className="rule-double font-semibold">
                {report.columns.map((column, index) => (
                  <td key={column.key} className={cn('px-3 py-2.5', numeric(column) ? 'text-right tabular' : 'text-left')}>
                    {index === 0 && report.totals?.[column.key] === undefined
                      ? 'Total'
                      : cell(report.totals?.[column.key], column)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {report.truncated && (
        <p className="mt-2 text-sm text-warning-foreground">
          This report was cut short at its row limit. Narrow the dates or the branch to see everything.
        </p>
      )}
      {report.notes?.map((note) => (
        <p key={note} className="mt-1 text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}
