/**
 * The one shape every report returns.
 *
 * A report is a titled table: named columns with a type, the rows, and optional
 * totals. Describing columns as data (rather than hard-coding each report's layout
 * in the web app) is what lets a single table component render all of them and the
 * same result export to CSV, and means a new report needs no new screen.
 */

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportRow = Record<string, string | number | Date | null>;

export interface ReportResult {
  key: string;
  title: string;
  /** The range the figures cover, when the report is about a period. */
  period?: { from: Date; to: Date };
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Summed figures for the numeric columns, shown under the table. */
  totals?: ReportRow;
  /** Notes the reader should see, e.g. that costs are hidden from them. */
  notes?: string[];
  /** True when the row cap cut the report short. */
  truncated?: boolean;
}

/** More rows than this are not a report, they are a data dump. */
export const MAX_REPORT_ROWS = 5000;
