import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The base button, in the shadcn/ui style.
 *
 * Variants are declared once with cva so the app cannot slowly grow twelve
 * subtly different "primary" buttons. Sizes lean compact - ERP screens fit more
 * work on screen than marketing pages do.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-semibold tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:brightness-125',
        secondary: 'border-border bg-secondary text-secondary-foreground hover:bg-accent',
        outline:
          'border-input bg-card text-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] hover:bg-accent hover:text-accent-foreground',
        ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:brightness-125',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
