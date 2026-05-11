import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const rowVariants = cva(
  'flex w-full items-center gap-2 rounded-md text-left transition-colors duration-fast ease-steno',
  {
    variants: {
      size: {
        sm: 'px-2 py-1 text-xs',
        md: 'px-2 py-1.5 text-sm',
        lg: 'px-3 py-2 text-sm',
      },
      interactive: {
        true: 'cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        false: '',
      },
      active: {
        true: 'bg-muted font-medium',
        false: '',
      },
    },
    defaultVariants: { size: 'md', interactive: false, active: false },
  }
);

export interface RowProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>,
    VariantProps<typeof rowVariants> {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  as?: 'div' | 'button' | 'li';
  label: React.ReactNode;
}

export const Row = React.forwardRef<HTMLElement, RowProps>(
  (
    {
      className,
      size,
      active,
      icon,
      trailing,
      collapsible,
      open,
      onClick,
      as,
      label,
      ...props
    },
    ref,
  ) => {
    const clickable = !!onClick || collapsible;
    const Tag = (as ?? (clickable ? 'button' : 'div')) as 'button';
    const chevron = collapsible ? (
      <ChevronRight
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform duration-fast ease-steno',
          open && 'rotate-90',
        )}
      />
    ) : null;

    return (
      <Tag
        ref={ref as never}
        onClick={onClick}
        type={Tag === 'button' ? 'button' : undefined}
        aria-expanded={collapsible ? !!open : undefined}
        className={cn(
          rowVariants({ size, interactive: clickable, active, className }),
        )}
        {...(props as React.HTMLAttributes<HTMLButtonElement>)}
      >
        {chevron}
        {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing && (
          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
            {trailing}
          </span>
        )}
      </Tag>
    );
  },
);
Row.displayName = 'Row';

export { rowVariants };
