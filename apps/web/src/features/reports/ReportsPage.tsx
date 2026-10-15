import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useBranches } from '@/hooks/useBranches';
import { downloadFile } from '@/lib/download';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { PrintHeader } from '@/components/PrintHeader';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { ReportTable } from './ReportTable';
import { reportQuery, useReport, useReportCatalog, type ReportParams } from './reportsApi';

/**
 * Reports.
 *
 * The list on the left comes from the server, which only offers what this person may
 * run; the filters follow from the report chosen. The same selection downloads as a
 * spreadsheet or prints, so the figures on screen and on paper are one result.
 */

const GROUP_LABELS: Record<string, string> = {
  day: 'Day',
  month: 'Month',
  product: 'Product',
  customer: 'Customer',
  branch: 'Branch',
  method: 'Payment method',
  supplier: 'Supplier',
  category: 'Category',
};

export function ReportsPage() {
  const { data: catalog, isPending: catalogPending, isError, error, refetch } = useReportCatalog();
  const { data: branches } = useBranches();

  const [selected, setSelected] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const entry = catalog?.find((report) => report.key === selected);

  useEffect(() => {
    if (!selected && catalog?.[0]) setSelected(catalog[0].key);
  }, [catalog, selected]);

  useEffect(() => {
    setGroupBy(entry?.groupBy?.default ?? '');
  }, [entry]);

  const params: ReportParams = {
    ...(entry?.filters.includes('period') && from ? { from } : {}),
    ...(entry?.filters.includes('period') && to ? { to } : {}),
    ...(entry?.filters.includes('branch') && branchId ? { branchId } : {}),
    ...(entry?.groupBy && groupBy ? { groupBy } : {}),
  };

  const { data: report, isPending, isError: reportFailed, error: reportError } = useReport(selected, params);

  async function download() {
    if (!selected) return;
    setDownloadError(null);
    try {
      await downloadFile(`/reports/${selected}${reportQuery(params)}`, `${selected}.csv`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Could not download the report');
    }
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load the reports'} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PrintHeader title={report?.title ?? 'Report'} />
      <PageHeader title="Reports" subtitle="रिपोर्ट" description="Figures for any period, ready to print or open in a spreadsheet" />

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav className="print:hidden">
          {catalogPending && <Skeleton className="h-48" />}
          <ul className="space-y-1">
            {catalog?.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => setSelected(item.key)}
                  className={cn(
                    'w-full rounded-md border-l-[3px] px-3 py-2 text-left transition-colors',
                    selected === item.key
                      ? 'border-brass bg-accent font-semibold'
                      : 'border-transparent hover:bg-accent/60',
                  )}
                >
                  <span className="block font-serif text-sm">{item.title}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{item.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="min-w-0">
          {entry && (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-x-4 print:hidden">
                {entry.groupBy && (
                  <Field label="Group by" className="mb-2 w-40">
                    <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                      {entry.groupBy.options.map((option) => (
                        <option key={option} value={option}>
                          {GROUP_LABELS[option] ?? option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {entry.filters.includes('period') && (
                  <>
                    <Field label="From" className="mb-2">
                      <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                    </Field>
                    <Field label="To" className="mb-2">
                      <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                    </Field>
                  </>
                )}
                {entry.filters.includes('branch') && branches && branches.length > 1 && (
                  <Field label="Branch" className="mb-2 w-44">
                    <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                      <option value="">All branches</option>
                      {branches.map((branch) => (
                        <option key={branch._id} value={branch._id}>
                          {branch.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className="mb-2 ml-auto flex gap-2">
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" aria-hidden />
                    Print
                  </Button>
                  <Button variant="outline" onClick={() => void download()}>
                    <Download className="h-4 w-4" aria-hidden />
                    Download CSV
                  </Button>
                </div>
              </div>

              {downloadError && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{downloadError}</p>}

              <h2 className="mb-1 font-serif text-lg font-semibold">{report?.title ?? entry.title}</h2>
              {report?.period && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {formatDate(report.period.from)} to {formatDate(report.period.to)}
                </p>
              )}

              {reportFailed ? (
                <ErrorState message={reportError instanceof Error ? reportError.message : 'Could not run the report'} />
              ) : isPending ? (
                <Skeleton className="h-64" />
              ) : report ? (
                <ReportTable report={report} />
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
