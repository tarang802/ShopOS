import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '@/lib/apiClient';

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportResult {
  key: string;
  title: string;
  period?: { from: string; to: string };
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  notes?: string[];
  truncated?: boolean;
}

export interface ReportCatalogEntry {
  key: string;
  title: string;
  description: string;
  filters: ('period' | 'branch')[];
  groupBy?: { options: string[]; default: string };
}

/** The reports this person may run. The server decides, so the screen never hard-codes the list. */
export function useReportCatalog() {
  return useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api.get<ReportCatalogEntry[]>('/reports'),
    staleTime: 10 * 60_000,
  });
}

export interface ReportParams {
  from?: string;
  to?: string;
  branchId?: string;
  groupBy?: string;
}

export function useReport(key: string | undefined, params: ReportParams) {
  return useQuery({
    queryKey: ['reports', key, params],
    queryFn: () => api.get<ReportResult>(`/reports/${key}${toQuery({ ...params })}`),
    enabled: Boolean(key),
  });
}

export function reportQuery(params: ReportParams): string {
  return toQuery({ ...params, format: 'csv' });
}
