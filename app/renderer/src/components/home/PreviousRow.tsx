import { Folder as FolderIcon, Loader2 } from 'lucide-react';
import type { Meeting } from '@/lib/ipc';
import { navigate } from '@/lib/router';
import { useMeetingsList } from '@/lib/meetingsListContext';

interface PreviousRowProps {
  meeting: Meeting;
  folderName?: string;
}

export function PreviousRow({ meeting, folderName }: PreviousRowProps) {
  const info = meeting.session_info;
  const when = formatTime(info.processed_at ?? info.updated_at);
  const duration = formatDuration(info.duration_seconds);
  const preview = previewText(meeting);
  const participants = Array.isArray(meeting.participants)
    ? meeting.participants.length
    : 0;
  const list = useMeetingsList();
  const isLive = meeting.is_recording;
  const isProcessing = meeting.is_processing;
  const isSynthetic = isLive || isProcessing;

  // Synthetic rows route to the live or processing screen instead of trying
  // to open the sentinel summary_file (which doesn't exist on disk yet).
  const targetPath = isLive
    ? '/recording'
    : isProcessing
      ? '/meetings/processing'
      : `/meetings/${encodeURIComponent(info.summary_file)}`;

  return (
    <div
      className="previous-row"
      data-testid="previous-row"
      data-recording={isLive ? 'true' : undefined}
      data-processing={isProcessing ? 'true' : undefined}
      role="button"
      tabIndex={0}
      draggable={!isSynthetic && !!list}
      onDragStart={(e) =>
        !isSynthetic && list?.startMeetingDrag(info.summary_file, e)
      }
      onContextMenu={(e) =>
        !isSynthetic && list?.openMeetingContextMenu(info.summary_file, e)
      }
      onClick={() => navigate(targetPath)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(targetPath);
        }
      }}
    >
      <div
        className="pt-0.5 text-[12.5px] tabular-nums"
        style={{ color: 'var(--fg-2)' }}
      >
        {isSynthetic ? 'Now' : (when ?? '')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <div
            className="truncate text-sm font-medium tracking-[-0.005em]"
            style={{ color: 'var(--fg-1)' }}
          >
            {info.name || 'Untitled note'}
          </div>
          {isLive && <LiveBadge />}
          {isProcessing && <ProcessingBadge />}
        </div>
        {preview && !isSynthetic && (
          <div
            className="line-clamp-1 text-[13px] leading-[1.5]"
            style={{ color: 'var(--fg-2)' }}
          >
            {preview}
          </div>
        )}
        {(folderName || participants > 0) && (
          <div
            className="mt-0.5 flex items-center gap-2.5 text-xs"
            style={{ color: 'var(--fg-muted)' }}
          >
            {folderName && (
              <span
                className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px]"
                style={{ background: 'var(--surface-hover)', color: 'var(--fg-2)' }}
              >
                <FolderIcon className="size-[11px]" />
                {folderName}
              </span>
            )}
            {participants > 0 && (
              <>
                {folderName && <span className="opacity-50">·</span>}
                <span>
                  {participants} {participants === 1 ? 'person' : 'people'}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div
        className="flex flex-col items-end gap-1.5 pt-0.5 text-xs tabular-nums"
        style={{ color: 'var(--fg-2)' }}
      >
        {duration && <span>{duration}</span>}
      </div>
    </div>
  );
}

function LiveBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: 'var(--recording)',
        color: '#FFFFFF',
      }}
    >
      <span
        aria-hidden
        className="inline-block size-1.5 rounded-full bg-white"
        style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
      />
      Recording
    </span>
  );
}

function ProcessingBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: 'var(--surface-sunken)',
        color: 'var(--fg-2)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <Loader2 className="size-[10px] animate-spin" aria-hidden />
      Processing
    </span>
  );
}

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(seconds?: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function previewText(meeting: Meeting): string | undefined {
  const summary = meeting.summary?.trim();
  if (summary) return summary;
  const kp = meeting.key_points?.[0];
  if (typeof kp === 'string' && kp.trim()) return kp.trim();
  return undefined;
}
