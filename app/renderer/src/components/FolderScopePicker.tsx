import * as React from 'react';
import { ChevronDown, Folder as FolderIcon, Inbox } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useFolders } from '@/hooks/useFolders';
import type { Folder } from '@/lib/ipc';

interface FolderScopePickerProps {
  /** Selected folder ID. null = all notes. */
  value: string | null;
  onChange: (folderId: string | null) => void;
}

/**
 * Compact "scope" chip used inside chat composers. Lets the user limit a
 * cross-note query to a single folder instead of asking across everything.
 * Backend filter happens server-side; this just persists the choice and
 * passes it to startGlobalStream.
 */
export function FolderScopePicker({ value, onChange }: FolderScopePickerProps) {
  const folders = useFolders();
  const [open, setOpen] = React.useState(false);

  const folder = React.useMemo<Folder | null>(() => {
    if (!value) return null;
    return folders.data?.find((f) => f.id === value) ?? null;
  }, [folders.data, value]);

  // If the scoped folder was deleted out from under us, drop the scope so we
  // don't keep filtering against a dead id (and so the chip stops lying about
  // what's selected).
  React.useEffect(() => {
    if (value && folders.data && !folder) {
      onChange(null);
    }
  }, [value, folders.data, folder, onChange]);

  const label = folder ? folder.name : 'All notes';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Scope: ${label}`}
          title={`Scope: ${label}`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{ color: 'var(--fg-2)' }}
        >
          {folder ? (
            <FolderIcon className="size-[12px]" />
          ) : (
            <Inbox className="size-[12px]" />
          )}
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronDown className="size-[11px] opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[220px] p-1">
        <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium" style={{ color: 'var(--fg-muted)' }}>
          Ask across…
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{
            color: 'var(--fg-1)',
            background: value === null ? 'var(--surface-active)' : undefined,
          }}
        >
          <Inbox className="size-[13px]" style={{ color: 'var(--fg-2)' }} />
          All notes
        </button>
        {(folders.data ?? []).length > 0 && (
          <div
            className="mx-2 my-1 h-px"
            style={{ background: 'var(--border-subtle)' }}
            aria-hidden
          />
        )}
        {(folders.data ?? []).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              onChange(f.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{
              color: 'var(--fg-1)',
              background: value === f.id ? 'var(--surface-active)' : undefined,
            }}
          >
            <FolderIcon className="size-[13px]" style={{ color: 'var(--fg-2)' }} />
            <span className="truncate">{f.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
