import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The first real end-to-end screen: React -> Express -> Mongoose -> MongoDB.
 *
 * It also proves out the patterns every later screen will copy - the query
 * hook, the typed API client, and the loading / error states the UI rules
 * require.
 */

interface HealthStatus {
  name: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    state: string;
    topology: string;
    supportsTransactions: boolean;
  };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular">{children}</span>
    </div>
  );
}

export function SystemStatusPage() {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthStatus>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">System Status</h1>
          <p className="text-sm text-muted-foreground">
            Live connection check between the web client, the API and MongoDB.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {isPending && (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Contacting the API...
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Cannot reach the API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
            <p>
              Start the API with{' '}
              <code className="rounded bg-muted px-1 py-0.5">npm run dev:api</code> and confirm
              MongoDB is running.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {data.name} v{data.version}
              <Badge variant="success">Connected</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="Environment">{data.environment}</Row>
            <Row label="Uptime">{data.uptimeSeconds}s</Row>
            <Row label="Database">
              <Badge variant={data.database.state === 'connected' ? 'success' : 'destructive'}>
                {data.database.state}
              </Badge>
            </Row>
            <Row label="Topology">{data.database.topology}</Row>
            <Row label="Multi-document transactions">
              <Badge variant={data.database.supportsTransactions ? 'success' : 'warning'}>
                {data.database.supportsTransactions ? 'Supported' : 'Unavailable'}
              </Badge>
            </Row>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
