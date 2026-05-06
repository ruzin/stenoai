import * as React from 'react';
import { cn } from '@/lib/utils';

type HProps = React.HTMLAttributes<HTMLHeadingElement>;

// Merge default fontVariationSettings with caller-supplied style so a
// downstream style={{ color: 'red' }} doesn't drop the variation defaults.
const DISPLAY_VAR = "'opsz' 144, 'SOFT' 30";
const H2_VAR = "'opsz' 96";

export function Display({ className, style, ...props }: HProps) {
  return (
    <h1
      className={cn(
        'font-serif text-3xl leading-[1.05] tracking-[-0.02em]',
        className
      )}
      style={{ fontVariationSettings: DISPLAY_VAR, ...style }}
      {...props}
    />
  );
}

export function H1({ className, style, ...props }: HProps) {
  return (
    <h1
      className={cn(
        'font-serif text-2xl leading-[1.1] tracking-[-0.02em]',
        className
      )}
      style={{ fontVariationSettings: DISPLAY_VAR, ...style }}
      {...props}
    />
  );
}

export function H2({ className, style, ...props }: HProps) {
  return (
    <h2
      className={cn(
        'font-serif text-xl leading-[1.25] tracking-[-0.01em]',
        className
      )}
      style={{ fontVariationSettings: H2_VAR, ...style }}
      {...props}
    />
  );
}

export function H3({ className, ...props }: HProps) {
  return (
    <h3
      className={cn('font-sans text-lg font-medium leading-[1.3]', className)}
      {...props}
    />
  );
}

export function Lead({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-md text-muted-foreground leading-[1.55]', className)}
      {...props}
    />
  );
}

export function Muted({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
