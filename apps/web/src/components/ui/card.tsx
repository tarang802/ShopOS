import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type DivProps = HTMLAttributes<HTMLDivElement>;

/**
 * A framed panel, like a ruled page in a register: a solid border, a faint shadow
 * along the bottom edge, and a tinted title strip separated from the body by a rule.
 */
export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card text-card-foreground shadow-[0_1px_0_rgba(0,0,0,0.05),0_2px_6px_-3px_rgba(0,0,0,0.12)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border bg-muted/60 px-5 py-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-5', className)} {...props} />;
}
