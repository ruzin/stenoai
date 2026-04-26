import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors duration-fast ease-steno focus:outline-none [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-border bg-transparent text-foreground hover:bg-muted',
        muted:
          'border-transparent bg-muted text-muted-foreground hover:bg-paper-2 dark:hover:bg-[hsl(54,7%,18%)]',
        destructive:
          'border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15',
      },
      interactive: {
        true: 'cursor-pointer',
        false: 'cursor-default',
      },
    },
    defaultVariants: { variant: 'default', interactive: false },
  }
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  asButton?: boolean;
}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, variant, interactive, asButton, onClick, ...props }, ref) => {
    const clickable = !!onClick || !!interactive || !!asButton;
    const Comp = (asButton ? 'button' : 'span') as 'span';
    return (
      <Comp
        ref={ref as never}
        onClick={onClick}
        role={asButton ? undefined : clickable ? 'button' : undefined}
        tabIndex={asButton ? undefined : clickable ? 0 : undefined}
        className={cn(chipVariants({ variant, interactive: clickable, className }))}
        {...props}
      />
    );
  }
);
Chip.displayName = 'Chip';

export { chipVariants };
