import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Form controls.
 *
 * Sized for data entry, not for marketing pages: 40px tall, generous tap
 * targets for a counter touchscreen, and a visible focus ring because ERP staff
 * move through forms with the keyboard far faster than with a mouse.
 *
 * A native <select> is used rather than a custom dropdown. It is keyboard
 * accessible for free, opens as the system picker on a phone, and does not
 * break when the shop connection is slow enough that JavaScript lags.
 */

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-[13px] font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]',
        'placeholder:text-muted-foreground focus-visible:border-ring',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]',
        'focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * A labelled field with room for a hint and an error.
 *
 * The error slot is always rendered when present rather than replacing the hint,
 * so the form does not jump as the user types and fixes a mistake.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4', className)}>
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
