import * as React from 'react';
import { cn } from '@/lib/utils';

export function KbdKey({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
