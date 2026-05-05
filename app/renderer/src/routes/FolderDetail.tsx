import * as React from 'react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { PreviousRow } from '@/components/home/PreviousRow';
import { useMeetings } from '@/hooks/useMeetings';
import { useFolders, useUpdateFolderIcon } from '@/hooks/useFolders';
import { LucideIcon, IconPicker } from '@/components/IconPicker';
import { navigate } from '@/lib/router';

interface FolderDetailProps {
  folderId: string;
}

export function FolderDetail({ folderId }: FolderDetailProps) {
  const meetings = useMeetings();
  const folders = useFolders();
  const updateIcon = useUpdateFolderIcon();
  const [iconPickerAnchor, setIconPickerAnchor] = React.useState<DOMRect | null>(null);

  const folder = folders.data?.find((f) => f.id === folderId);
  const filtered = (meetings.data ?? []).filter((m) =>
    (m.folders ?? m.session_info.folders ?? []).includes(folderId),
  );

  const isLoading = meetings.isLoading || folders.isLoading;

  return (
    <MeetingsShell activeSummaryFile={null}>
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-[color:var(--fg-2)]">
          Loading folder…
        </div>
      ) : !folder ? (
        <div className="space-y-4 text-center">
          <h1 className="home-hello">Folder not found.</h1>
          <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
            This folder may have been deleted.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => navigate('/')}
              style={{ color: 'var(--fg-1)' }}
            >
              Back to Home
            </button>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="mb-10">
            <div className="mb-1.5 flex items-end justify-between gap-6">
              <h1 className="home-hello flex items-center gap-3.5">
                <button
                  type="button"
                  aria-label="Change folder icon"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[color:var(--surface-active)]"
                  style={{ background: 'var(--surface-hover)', color: 'var(--fg-1)', flexShrink: 0 }}
                  onClick={(e) => setIconPickerAnchor(e.currentTarget.getBoundingClientRect())}
                >
                  <LucideIcon name={folder.icon ?? 'folder'} size={20} />
                </button>
                {folder.name}
              </h1>
              {iconPickerAnchor && (
                <IconPicker
                  anchorRect={iconPickerAnchor}
                  onSelect={(icon) => updateIcon.mutate({ id: folderId, icon })}
                  onClose={() => setIconPickerAnchor(null)}
                />
              )}
              <div
                className="pb-2 text-[13px] tabular-nums"
                style={{ color: 'var(--fg-2)' }}
              >
                {filtered.length} {filtered.length === 1 ? 'meeting' : 'meetings'}
              </div>
            </div>
          </div>

          <section>
            <div className="mb-3.5 flex items-baseline justify-between pb-2.5">
              <div className="flex items-baseline gap-2.5">
                <h2
                  className="text-sm font-medium tracking-[-0.005em]"
                  style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
                >
                  Meetings
                </h2>
                <span
                  className="text-[12.5px] tabular-nums"
                  style={{ color: 'var(--fg-muted)' }}
                >
                  {filtered.length}
                </span>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-6 py-24 text-center" style={{ color: 'var(--fg-2)' }}>
                <div
                  className="mb-1.5"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 24,
                    color: 'var(--fg-1)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Nothing here yet
                </div>
                <div
                  className="mx-auto max-w-[40ch] text-[13.5px] leading-[1.55]"
                  style={{ color: 'var(--fg-2)' }}
                >
                  Meetings you save to this folder will show up here.
                </div>
              </div>
            ) : (
              <div>
                {filtered.map((m) => (
                  <PreviousRow
                    key={m.session_info.summary_file}
                    meeting={m}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </MeetingsShell>
  );
}
