import type { ReportColumn, ReportResult, ReportRow } from './reportTypes';

/**
 * Report to CSV.
 *
 * Two things matter more than they look.
 *
 * Money is written in rupees with two decimals, because the people opening this
 * in a spreadsheet want 1234.50, not 123450 paise.
 *
 * And any text cell that starts with =, +, - or @ is prefixed with an apostrophe.
 * A customer named `=HYPERLINK("http://evil",...)` would otherwise run as a formula
 * the moment an accountant opens the file - CSV injection - and customer, product
 * and supplier names are typed by anyone with access.
 */

const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function neutraliseFormula(text: string): string {
  return text.length > 0 && FORMULA_STARTS.has(text[0]!) ? `'${text}` : text;
}

function escapeCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatCell(value: ReportRow[string] | undefined, column: ReportColumn): string {
  if (value === null || value === undefined) return '';

  switch (column.type) {
    case 'money':
      return typeof value === 'number' ? (value / 100).toFixed(2) : '';
    case 'percent':
      return typeof value === 'number' ? value.toFixed(1) : '';
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'date':
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    default:
      return neutraliseFormula(String(value));
  }
}

export function toCsv(report: ReportResult): string {
  const header = report.columns.map((column) => escapeCell(neutraliseFormula(column.label))).join(',');

  const lines = report.rows.map((row) =>
    report.columns.map((column) => escapeCell(formatCell(row[column.key], column))).join(','),
  );

  if (report.totals) {
    const totals = report.totals;
    lines.push(
      report.columns
        .map((column, index) =>
          index === 0 && totals[column.key] === undefined
            ? 'Total'
            : escapeCell(formatCell(totals[column.key], column)),
        )
        .join(','),
    );
  }

  // The byte-order mark makes Excel read the file as UTF-8, which matters for
  // names written in Hindi.
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
