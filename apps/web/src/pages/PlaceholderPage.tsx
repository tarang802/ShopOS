import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Stand-in for a module that has not been built yet.
 *
 * Every route in the navigation resolves to something real from day one, so the
 * shell can be clicked through end to end and the build order stays visible.
 */
export function PlaceholderPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      <Card>
        <CardHeader>
          <CardTitle>Not built yet</CardTitle>
          <CardDescription>
            This module arrives in {phase}. The route and navigation exist now so the shell can be
            navigated end to end while the backend is built.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
