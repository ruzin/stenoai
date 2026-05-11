import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  'flex w-full rounded-md border border-border bg-transparent text-sm transition-colors duration-fast ease-steno placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
        sunken: 'border-transparent bg-paper-1 dark:bg-[hsl(54,7%,14%)]',
        inherit:
          'border-transparent bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] tracking-[inherit]',
      },
      size: {
        default: 'h-9 px-3',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-4 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

type Size = NonNullable<VariantProps<typeof inputVariants>['size']>;
type Variant = NonNullable<VariantProps<typeof inputVariants>['variant']>;

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: Variant;
  size?: Size;
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, iconStart, iconEnd, type = 'text', ...props }, ref) => {
    const hasStart = !!iconStart;
    const hasEnd = !!iconEnd;
    const input = (
      <input
        type={type}
        ref={ref}
        className={cn(
          inputVariants({ variant, size, className }),
          hasStart && 'pl-8',
          hasEnd && 'pr-8',
        )}
        {...props}
      />
    );

    if (!hasStart && !hasEnd) return input;

    return (
      <div className="relative">
        {hasStart && (
          <span className="pointer-events-none absolute left-2.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-muted-foreground">
            {iconStart}
          </span>
        )}
        {input}
        {hasEnd && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-muted-foreground">
            {iconEnd}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: Variant;
  autoResize?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, autoResize, onInput, rows = 2, ...props }, ref) => {
    const handleInput = React.useCallback(
      (e: React.InputEvent<HTMLTextAreaElement>) => {
        if (autoResize) {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
        onInput?.(e);
      },
      [autoResize, onInput],
    );

    return (
      <textarea
        ref={ref}
        rows={rows}
        onInput={handleInput}
        className={cn(
          inputVariants({ variant, size: 'default', className }),
          'min-h-[36px] resize-none py-2',
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { inputVariants };
