import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared Settings primitives — style helpers + layout rows used across more
// than one tab. Values come straight from the design (Pencil bundle at
// /tmp/design-extract/.../Settings.jsx). Kept local to the Settings route
// rather than promoted to /components/ui because they only fit this layout.
// ---------------------------------------------------------------------------

export const COMPACT_TRIGGER =
  'h-[30px] min-w-[150px] rounded-[6px] bg-[color:var(--surface-raised)] px-2.5 py-0 text-[13px]';
export const COMPACT_BTN = 'h-[30px] px-3 text-[13px]';

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  align?: 'center' | 'start';
  noBorder?: boolean;
  muted?: boolean;
}

export function SettingRow({
  label,
  description,
  children,
  align = 'center',
  noBorder = false,
  muted = false,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex gap-6 py-4',
        align === 'start' ? 'items-start' : 'items-center',
      )}
      style={{
        borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
        opacity: muted ? 0.45 : 1,
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="text-[14px] font-medium"
          style={{ color: 'var(--fg-1)', marginBottom: 2 }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-[13px] leading-[1.5]"
            style={{ color: 'var(--fg-2)' }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] font-medium uppercase"
      style={{
        letterSpacing: '0.06em',
        color: 'var(--fg-muted)',
        padding: '20px 0 8px',
      }}
    >
      {children}
    </div>
  );
}
