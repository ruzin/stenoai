import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Folder as FolderIcon, Globe, Inbox } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useFolders } from '@/hooks/useFolders';
import { useOrgSession } from '@/hooks/useOrg';
import type { Folder } from '@/lib/ipc';

/** Sentinel for "ask across the org-shared corpus instead of local notes".
 *  Comparable to a folder id so the picker / handoff plumbing doesn't have
 *  to carry a separate type. */
export const ORG_SHARED_SCOPE = '__org_shared__';

interface FolderScopePickerProps {
  /** Selected folder ID, or ORG_SHARED_SCOPE for the org corpus. null = all local notes. */
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
  const { t } = useTranslation();
  const folders = useFolders();
  const orgSession = useOrgSession();
  const orgSignedIn = orgSession.data?.signedIn ?? false;
  const [open, setOpen] = React.useState(false);

  const folder = React.useMemo<Folder | null>(() => {
    if (!value || value === ORG_SHARED_SCOPE) return null;
    return folders.data?.find((f) => f.id === value) ?? null;
  }, [folders.data, value]);

  // If the scoped folder was deleted out from under us, drop the scope so we
  // don't keep filtering against a dead id (and so the chip stops lying about
  // what's selected). Same goes for the org sentinel — if the user signs out
  // mid-session, we shouldn't keep claiming an org scope.
  //
  // Critically: gate the org clear on `orgSession.isSuccess`. Otherwise the
  // initial render — before useOrgSession() has settled — sees
  // `orgSignedIn === false` and would wipe a freshly-selected ORG_SHARED_SCOPE
  // before the auth status has actually loaded.
  const orgSessionSettled = orgSession.isSuccess;
  React.useEffect(() => {
    if (value && value !== ORG_SHARED_SCOPE && folders.data && !folder) {
      onChange(null);
    }
    if (value === ORG_SHARED_SCOPE && orgSessionSettled && !orgSignedIn) {
      onChange(null);
    }
  }, [value, folders.data, folder, orgSessionSettled, orgSignedIn, onChange]);

  const isOrg = value === ORG_SHARED_SCOPE;
  const label = isOrg ? t('nav.sharedNotes') : folder ? folder.name : t('nav.allNotes');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('chat.scopeAria', { scope: label })}
          title={t('chat.scopeAria', { scope: label })}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{ color: 'var(--fg-2)' }}
        >
          {isOrg ? (
            <Globe className="size-[12px]" />
          ) : folder ? (
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
          {t('chat.askAcross')}
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
          {t('nav.allNotes')}
        </button>
        {orgSignedIn && (
          <button
            type="button"
            onClick={() => {
              onChange(ORG_SHARED_SCOPE);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{
              color: 'var(--fg-1)',
              background: isOrg ? 'var(--surface-active)' : undefined,
            }}
            title={t('chat.orgScopeHint', {
              org: orgSession.data?.orgId ?? t('org.yourOrg'),
            })}
          >
            <Globe className="size-[13px]" style={{ color: 'var(--fg-2)' }} />
            <span className="truncate">{t('nav.sharedNotes')}</span>
          </button>
        )}
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
