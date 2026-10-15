import type { ReactNode } from 'react';
import type { Label } from '@/lib/labels';

/**
 * The heading every screen opens with: a serif title, the same word in Hindi
 * beneath it, and a double brass rule, like the head of a page in a register.
 *
 * The Hindi line is not decoration. Counter and godown staff often read the trade
 * word faster than the English one, and seeing both removes the moment of
 * hesitation about which screen they are on.
 */
export function PageHeader({
  title,
  subtitle,
  description,
  actions,
}: {
  title: string;
  /** The same word in Hindi, shown small underneath. */
  subtitle?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-double border-brass/70 pb-3">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-primary">{title}</h1>
          {subtitle && <span className="font-serif text-base italic text-muted-foreground">{subtitle}</span>}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Convenience wrapper for a header driven by a bilingual label. */
export function LabelledPageHeader({
  label,
  description,
  actions,
}: {
  label: Label;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={label.en}
      subtitle={label.hi}
      {...(description ? { description } : {})}
      {...(actions ? { actions } : {})}
    />
  );
}
