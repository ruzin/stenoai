import * as React from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Folder as FolderIcon,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useQueryClient } from '@tanstack/react-query';
import * as SelectPrimitive from '@radix-ui/react-select';
import { MeetingsShell } from '@/components/MeetingsShell';
import { Chip } from '@/components/ui/chip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
} from '@/components/ui/select';
import { useMeeting, useReprocessMeeting, useDeleteMeeting, meetingsKeys } from '@/hooks/useMeetings';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  useFolders,
  useAddMeetingToFolder,
  useRemoveMeetingFromFolder,
  useCreateFolder,
} from '@/hooks/useFolders';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useActiveMeeting } from '@/lib/askBarContext';
import { ipc, type CalendarEvent, type Meeting } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import {
  pendingTitleRegens,
  streamCache,
  type StreamPhase,
} from '@/lib/meetingDetailState';

const LAST_OPENED_KEY = 'steno-last-opened-meeting';

interface MeetingDetailProps {
  summaryFile: string;
}

export function MeetingDetail({ summaryFile }: MeetingDetailProps) {
  const meeting = useMeeting(summaryFile);
  useActiveMeeting(summaryFile, meeting.data?.session_info.name ?? null);

  React.useEffect(() => {
    if (meeting.data) {
      localStorage.setItem(LAST_OPENED_KEY, summaryFile);
    }
  }, [meeting.data, summaryFile]);

  return (
    <MeetingsShell activeSummaryFile={summaryFile}>
      {meeting.isLoading || (meeting.isFetching && !meeting.data) ? (
        <div className="flex min-h-[40vh] items-center justify-center text-[color:var(--fg-2)]">
          Loading meeting…
        </div>
      ) : !meeting.data ? (
        <div className="space-y-4 text-center">
          <h1 className="mv-title">Note not found.</h1>
          <p className="text-[17px] leading-[1.55]" style={{ color: 'var(--fg-2)' }}>
            This recording may have been deleted. Pick another from the sidebar.
          </p>
          <button
            type="button"
            className="mv-chip"
            onClick={() => navigate('/meetings')}
          >
            Back to meetings
          </button>
        </div>
      ) : (
        <DetailContent key={summaryFile} meeting={meeting.data} />
      )}
    </MeetingsShell>
  );
}

function DetailContent({ meeting }: { meeting: Meeting }) {
  const info = meeting.session_info;
  const summaryFile = info.summary_file;
  const date = formatDetailDate(info);
  const duration = formatDuration(info.duration_seconds);
  const [copied, setCopied] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const deleteMeeting = useDeleteMeeting();
  const reprocess = useReprocessMeeting();
  const [titleRegening, setTitleRegening] = React.useState(() =>
    pendingTitleRegens.has(summaryFile),
  );
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleError, setTitleError] = React.useState<string | null>(null);
  const titleEditRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const pending = pendingTitleRegens.get(summaryFile);
    if (!pending) return;
    setTitleRegening(true);
    let cancelled = false;
    pending.finally(() => {
      if (!cancelled) setTitleRegening(false);
    });
    return () => {
      cancelled = true;
    };
  }, [summaryFile]);

  React.useEffect(() => {
    if (isEditingTitle && titleEditRef.current) {
      const el = titleEditRef.current;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditingTitle]);

  const [titleKey, setTitleKey] = React.useState(0);
  const prevNameRef = React.useRef(info.name);
  React.useEffect(() => {
    if (info.name !== prevNameRef.current) {
      prevNameRef.current = info.name;
      setTitleKey((k) => k + 1);
      setTitleRegening(false);
      setTitleError(null);
    }
  }, [info.name]);

  const cached = streamCache.get(summaryFile);
  const [streamText, setStreamText] = React.useState(cached?.text ?? '');
  const [streamPhase, setStreamPhase] = React.useState<StreamPhase>(cached?.phase ?? 'idle');
  const qc = useQueryClient();

  React.useEffect(() => {
    streamCache.set(summaryFile, { text: streamText, phase: streamPhase });
  }, [summaryFile, streamText, streamPhase]);

  React.useEffect(() => {
    const sessionName = info.name;
    const offChunk = ipc().on.summaryChunk((e) => {
      if (e.sessionName !== sessionName) return;
      setStreamPhase((prev) => (prev === 'analyzing' ? 'generating' : prev));
      setStreamText((prev) => prev + e.chunk);
    });
    const offComplete = ipc().on.summaryComplete((e) => {
      if (e.sessionName !== sessionName) return;
      setStreamPhase('done');
    });
    const offProcessing = ipc().on.processingComplete((e) => {
      if (e.sessionName !== sessionName) return;
      void qc.invalidateQueries({ queryKey: meetingsKeys.all });
      setTimeout(() => {
        setStreamText('');
        setStreamPhase('idle');
        streamCache.delete(summaryFile);
      }, 400);
    });
    return () => {
      offChunk();
      offComplete();
      offProcessing();
    };
  }, [info.name, summaryFile, qc]);

  const copyNotes = () => {
    const lines: string[] = [info.name];
    const meta = [formatDetailDate(info), formatDuration(info.duration_seconds)]
      .filter(Boolean)
      .join(' · ');
    if (meta) lines.push(meta);
    const summary = meeting.summary?.trim();
    if (summary) {
      lines.push('', 'SUMMARY', summary);
    }
    const dAreas = asDiscussionAreas(meeting.discussion_areas);
    if (dAreas.length) {
      lines.push('', 'KEY TOPICS');
      dAreas.forEach((a) => lines.push(`- ${a.title}${a.analysis ? `: ${a.analysis}` : ''}`));
    }
    const kp = meeting.key_points ?? [];
    if (kp.length) {
      lines.push('', 'KEY POINTS');
      kp.forEach((p) => lines.push(`- ${p}`));
    }
    const ai = asStringArray(meeting.action_items);
    if (ai.length) {
      lines.push('', 'ACTION ITEMS');
      ai.forEach((a) => lines.push(`- ${a}`));
    }
    const parts = asStringArray(meeting.participants);
    if (parts.length) {
      lines.push('', 'PARTICIPANTS', parts.join(', '));
    }
    void navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const summary = meeting.summary?.trim();
  const participants = asStringArray(meeting.participants);
  const keyPoints = meeting.key_points ?? [];
  const actionItems = asStringArray(meeting.action_items);
  const discussionAreas = asDiscussionAreas(meeting.discussion_areas);

  return (
    <article data-testid="meeting-detail" className="space-y-9">
      <header
        className="flex flex-col gap-4 pb-6"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to home"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
            style={{ color: 'var(--fg-2)' }}
          >
            <ChevronLeft className="size-[15px]" />
            Home
          </button>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <ActionIconButton
                  label={copied ? 'Copied' : 'Copy notes'}
                  onClick={copyNotes}
                >
                  {copied ? <Check className="size-[13px]" /> : <Copy className="size-[13px]" />}
                </ActionIconButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">{copied ? 'Copied!' : 'Copy notes'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ActionIconButton
                  label="Regenerate notes"
                  onClick={() => {
                    setStreamText('');
                    setStreamPhase('analyzing');
                    streamCache.set(summaryFile, { text: '', phase: 'analyzing' });
                    reprocess.mutate({ summaryFile, regenTitle: false, name: info.name });
                  }}
                  disabled={reprocess.isPending || streamPhase !== 'idle'}
                >
                  <RefreshCw
                    className={cn(
                      'size-[13px]',
                      (reprocess.isPending ||
                        streamPhase === 'analyzing' ||
                        streamPhase === 'generating') &&
                        'animate-spin',
                    )}
                  />
                </ActionIconButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">Regenerate notes</TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  title="More options"
                  className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
                  style={{ color: 'var(--fg-2)' }}
                >
                  <MoreHorizontal className="size-[14px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{ color: 'var(--fg-1)' }}
                  onClick={() => {
                    const file = info.summary_file || info.transcript_file || info.audio_file;
                    if (file) ipc().meetings.revealFolder(file);
                  }}
                >
                  <FolderIcon className="size-[13px] shrink-0" style={{ color: 'var(--fg-2)' }} />
                  View containing folder
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-[13px] shrink-0" />
                  Delete note
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <h1
          data-testid="meeting-detail-title"
          key={titleKey}
          className={cn('mv-title group', titleKey > 0 && 'animate-title-in')}
        >
          <button
            type="button"
            onClick={async () => {
              if (pendingTitleRegens.has(summaryFile)) return;
              setTitleError(null);
              setTitleRegening(true);
              const task = (async () => {
                try {
                  unwrap(await ipc().meetings.regenTitle(summaryFile, info.name));
                  await qc.invalidateQueries({ queryKey: meetingsKeys.all });
                } finally {
                  pendingTitleRegens.delete(summaryFile);
                }
              })();
              pendingTitleRegens.set(summaryFile, task);
              try {
                await task;
              } catch (error) {
                setTitleError(getErrorMessage(error));
              } finally {
                setTitleRegening(false);
              }
            }}
            disabled={
              titleRegening ||
              reprocess.isPending ||
              streamPhase !== 'idle' ||
              isEditingTitle
            }
            aria-label="Regenerate title"
            title="Regenerate title"
            className={cn(
              'inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 disabled:pointer-events-none',
              titleRegening && 'opacity-100',
            )}
            style={{
              verticalAlign: 'middle',
              color: 'var(--fg-1)',
              width: '1em',
              height: '1em',
              marginRight: '0.15em',
              marginLeft: '-1.15em',
            }}
          >
            <RefreshCw className={cn('size-[0.45em]', titleRegening && 'animate-spin')} />
          </button>
          {isEditingTitle ? (
            <span
              ref={titleEditRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const next = (e.currentTarget.textContent ?? '').trim();
                setIsEditingTitle(false);
                if (!next || next === info.name) return;
                void ipc()
                  .meetings.update(summaryFile, { name: next })
                  .then(() => qc.invalidateQueries({ queryKey: meetingsKeys.all }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.currentTarget as HTMLSpanElement).blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  if (titleEditRef.current) titleEditRef.current.textContent = info.name;
                  setIsEditingTitle(false);
                }
              }}
              className="outline-none"
            >
              {info.name}
            </span>
          ) : (
            <span className="cursor-text" onClick={() => setIsEditingTitle(true)}>
              {info.name}
            </span>
          )}
        </h1>

        <div className="flex flex-wrap gap-1.5">
          {date && (
            <ChipV2 icon={<CalendarIcon className="size-[11px]" />}>{date}</ChipV2>
          )}
          {duration && (
            <ChipV2 icon={<Clock className="size-[11px]" />}>{duration}</ChipV2>
          )}
          <FolderPicker
            summaryFile={summaryFile}
            assignedFolderIds={meeting.folders ?? meeting.session_info.folders ?? []}
          />
          {participants.length > 0 && (
            <ChipV2 icon={<Users className="size-[11px]" />}>
              {participants.length} {participants.length === 1 ? 'person' : 'people'}
            </ChipV2>
          )}
          {meeting.is_diarised && (
            <ChipV2 icon={<FolderIcon className="size-[11px]" />}>Diarised</ChipV2>
          )}
        </div>

        {titleError && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {titleError}
          </p>
        )}
      </header>

      {streamPhase !== 'idle' ? (
        <StreamingView text={streamText} phase={streamPhase} />
      ) : (
        <div className="flex flex-col gap-9">
          {summary ? (
            <section className="flex flex-col gap-3">
              <SectionTitle>Summary</SectionTitle>
              <div data-testid="tab-summary-content">
                {summary.split(/\n{2,}/).map((para, i) => (
                  <p
                    key={i}
                    className="text-[15.5px] leading-[1.65]"
                    style={{ color: 'var(--fg-1)', maxWidth: '64ch' }}
                  >
                    {para}
                  </p>
                ))}
              </div>
            </section>
          ) : (
            <p className="py-2 text-sm" style={{ color: 'var(--fg-2)' }}>
              No summary available for this meeting.
            </p>
          )}

          {discussionAreas.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle>Key topics</SectionTitle>
              <div className="mv-topics">
                {discussionAreas.map((area, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="mv-topic-title">{area.title}</div>
                    {area.analysis && <div className="mv-topic-body">{area.analysis}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {keyPoints.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle>Key points</SectionTitle>
              <ul className="mv-bullets">
                {keyPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </section>
          )}

          {actionItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle>Action items</SectionTitle>
              <ul className="mv-bullets">
                {actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </section>
          )}

          {participants.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle>Participants</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p, i) => (
                  <ChipV2 key={i}>{p}</ChipV2>
                ))}
              </div>
            </section>
          )}

          <CalendarSection meeting={meeting} />
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>
              This will permanently delete the recording, transcript, and summary. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={deleteMeeting.isPending}
              onClick={async () => {
                await deleteMeeting.mutateAsync(meeting);
                navigate('/');
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[13px] font-semibold tracking-[0.01em]"
      style={{
        color: 'var(--fg-2)',
        fontFamily: 'var(--font-sans)',
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}

interface ChipV2Props {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}

function ChipV2({ icon, children, onClick }: ChipV2Props) {
  return (
    <button
      type="button"
      className="mv-chip"
      onClick={onClick}
      style={onClick ? undefined : { cursor: 'default' }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

const ActionIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function ActionIconButton({ label, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)] disabled:opacity-50"
      style={{ color: 'var(--fg-2)' }}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Streaming view (kept in this file because StreamingView's pinned-indicator
// reads #ask-bar-slot dimensions; staying close to MeetingDetail keeps the
// scroll/position math explicit).
// ---------------------------------------------------------------------------

interface MarkdownBlock {
  type: 'heading' | 'bullet' | 'paragraph';
  text: string;
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    bulletBuffer.forEach((t) => blocks.push({ type: 'bullet', text: t }));
    bulletBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s+/.test(line)) {
      flushBullets();
      blocks.push({ type: 'heading', text: line.replace(/^#{1,3}\s+/, '') });
    } else if (/^[-*]\s+/.test(line)) {
      bulletBuffer.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flushBullets();
    } else {
      flushBullets();
      blocks.push({ type: 'paragraph', text: line });
    }
  }
  flushBullets();
  return blocks.filter((b) => b.text.trim());
}

const CHAR_TRANSITION = 'top 0.12s ease-out';
const ROW_TRANSITION = 'top 0.35s cubic-bezier(0.45, 0, 0.55, 1)';

function StreamingView({ text, phase }: { text: string; phase: StreamPhase }) {
  const blocks = parseMarkdownBlocks(text);
  const isStreaming = phase === 'analyzing' || phase === 'generating';

  const prevBlockCountRef = React.useRef(blocks.length);
  const firstNewIdx = prevBlockCountRef.current;
  React.useEffect(() => {
    prevBlockCountRef.current = blocks.length;
  }, [blocks.length]);

  const blocksContainerRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = React.useRef<HTMLDivElement>(null);
  const rowCountRef = React.useRef(blocks.length);
  const rowTransitionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTransitionRef = React.useRef(CHAR_TRANSITION);
  const naturalTopRef = React.useRef(0);
  const isPinnedRef = React.useRef(false);

  const repositionIndicator = React.useCallback(() => {
    const container = blocksContainerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const containerRect = container.getBoundingClientRect();
    const naturalViewportTop = containerRect.top + naturalTopRef.current;
    const indicatorH = 44;
    const askBar = document.getElementById('ask-bar-slot');
    const clearance = (askBar ? askBar.offsetHeight : 80) + 8;
    const pinnedViewportTop = window.innerHeight - indicatorH - clearance;

    if (naturalViewportTop <= pinnedViewportTop) {
      if (isPinnedRef.current) {
        isPinnedRef.current = false;
        indicator.style.transition = 'none';
        indicator.style.position = 'absolute';
        indicator.style.top = `${naturalTopRef.current}px`;
        indicator.style.left = '-12px';
        indicator.style.right = '-12px';
        indicator.style.width = '';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (indicatorRef.current) indicatorRef.current.style.transition = currentTransitionRef.current;
        }));
        return;
      }
      indicator.style.position = 'absolute';
      indicator.style.top = `${naturalTopRef.current}px`;
      indicator.style.left = '-12px';
      indicator.style.right = '-12px';
      indicator.style.width = '';
    } else {
      if (!isPinnedRef.current) {
        isPinnedRef.current = true;
        indicator.style.transition = 'none';
      }
      indicator.style.position = 'fixed';
      indicator.style.top = `${pinnedViewportTop}px`;
      indicator.style.left = `${containerRect.left - 12}px`;
      indicator.style.right = 'auto';
      indicator.style.width = `${container.offsetWidth + 24}px`;
    }
  }, []);

  React.useLayoutEffect(() => {
    const container = blocksContainerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const newTop = container.offsetHeight;
    const isNewRow = blocks.length !== rowCountRef.current;

    if (isNewRow) {
      rowCountRef.current = blocks.length;
      currentTransitionRef.current = ROW_TRANSITION;
      if (rowTransitionTimerRef.current) clearTimeout(rowTransitionTimerRef.current);
      rowTransitionTimerRef.current = setTimeout(() => {
        currentTransitionRef.current = CHAR_TRANSITION;
        if (indicatorRef.current && !isPinnedRef.current) {
          indicatorRef.current.style.transition = CHAR_TRANSITION;
        }
      }, 360);
    }

    naturalTopRef.current = newTop;
    if (!isPinnedRef.current) {
      indicator.style.transition = currentTransitionRef.current;
    }
    repositionIndicator();
  });

  React.useEffect(() => {
    if (!isStreaming) return;
    window.addEventListener('scroll', repositionIndicator, { passive: true });
    return () => window.removeEventListener('scroll', repositionIndicator);
  }, [isStreaming, repositionIndicator]);

  React.useEffect(() => () => {
    if (rowTransitionTimerRef.current) clearTimeout(rowTransitionTimerRef.current);
  }, []);

  const indicatorLabel = phase === 'analyzing' ? 'Analysing transcript' : 'Generating notes';

  return (
    <div className="relative">
      <div ref={blocksContainerRef} className="space-y-4">
        {blocks.map((block, i) => {
          const animate = i >= firstNewIdx;
          if (block.type === 'heading') {
            return (
              <SectionTitle key={i}>
                {block.text}
              </SectionTitle>
            );
          }
          if (block.type === 'bullet') {
            return (
              <div key={i} className={cn('flex gap-2', animate && 'animate-fade-in')}>
                <span className="mt-[0.45em] size-1 flex-shrink-0 rounded-full bg-[color:var(--fg-2)]" />
                <p className="text-sm leading-[1.65]" style={{ color: 'var(--fg-1)' }}>{block.text}</p>
              </div>
            );
          }
          return (
            <p
              key={i}
              className={cn('text-[15px] leading-[1.7]', animate && 'animate-fade-in')}
              style={{ color: 'var(--fg-1)' }}
            >
              {block.text}
            </p>
          );
        })}
      </div>
      {isStreaming && (
        <div
          ref={indicatorRef}
          className="pointer-events-none absolute -left-3 -right-3 flex h-11 items-center gap-2 rounded-lg px-3"
          style={{
            top: 0,
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <span
            className="inline-block size-3 animate-spin-fast rounded-full border-2 border-transparent"
            style={{ borderTopColor: 'var(--fg-2)' }}
          />
          <span className="text-xs" style={{ color: 'var(--fg-1)' }}>{indicatorLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar section (related events for a meeting)
// ---------------------------------------------------------------------------

function CalendarSection({ meeting }: { meeting: Meeting }) {
  const calendar = useCalendarEvents();
  const state = calendar.data;

  if (calendar.isLoading || !state || state.needsAuth) return null;

  const related = findRelatedEvents(state.events, meeting);
  if (related.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Calendar</SectionTitle>
      <ul className="space-y-3">
        {related.map((event) => (
          <li
            key={event.id}
            className="rounded-md border p-4"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--surface-raised)',
            }}
          >
            <div className="flex items-start gap-3">
              <CalendarIcon
                className="mt-0.5 size-4 flex-shrink-0"
                style={{ color: 'var(--fg-2)' }}
              />
              <div className="flex-1 space-y-1">
                <div className="font-medium" style={{ color: 'var(--fg-1)' }}>{event.title}</div>
                <div className="text-xs" style={{ color: 'var(--fg-2)' }}>
                  {formatEventTime(event)}
                </div>
                {event.location && (
                  <div className="text-xs" style={{ color: 'var(--fg-2)' }}>{event.location}</div>
                )}
                {event.attendees && event.attendees.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {event.attendees.slice(0, 6).map((a, i) => (
                      <Chip key={i} variant="muted">
                        {a.name ?? a.email}
                      </Chip>
                    ))}
                    {event.attendees.length > 6 && (
                      <Chip variant="muted">+{event.attendees.length - 6}</Chip>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Folder picker (meeting → folder assignment via the chip dropdown)
// ---------------------------------------------------------------------------

const FOLDER_NONE = '__none__';
const FOLDER_NEW = '__new__';

function FolderPicker({ summaryFile, assignedFolderIds }: { summaryFile: string; assignedFolderIds: string[] }) {
  const folders = useFolders();
  const addMeeting = useAddMeetingToFolder();
  const removeMeeting = useRemoveMeetingFromFolder();
  const createFolder = useCreateFolder();
  const [newFolderName, setNewFolderName] = React.useState('');
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [folderError, setFolderError] = React.useState<string | null>(null);
  const newFolderInputRef = React.useRef<HTMLInputElement>(null);

  const allFolders = folders.data ?? [];
  const serverFolderId = assignedFolderIds[0] ?? null;
  const [localFolderId, setLocalFolderId] = React.useState<string | null>(serverFolderId);
  React.useEffect(() => { setLocalFolderId(serverFolderId); }, [serverFolderId]);

  const currentFolder = allFolders.find((f) => f.id === localFolderId) ?? null;

  const assignFolder = async (nextFolderId: string | null) => {
    const previousFolderId = localFolderId;
    if (previousFolderId === nextFolderId) return;

    setFolderError(null);
    setLocalFolderId(nextFolderId);

    try {
      if (previousFolderId && nextFolderId) {
        await addMeeting.mutateAsync({ summaryFile, folderId: nextFolderId });
        try {
          await removeMeeting.mutateAsync({ summaryFile, folderId: previousFolderId });
        } catch (error) {
          await removeMeeting.mutateAsync({ summaryFile, folderId: nextFolderId }).catch(() => {
            // Query invalidation from the mutation hooks will restore server state.
          });
          throw error;
        }
        return;
      }

      if (previousFolderId) {
        await removeMeeting.mutateAsync({ summaryFile, folderId: previousFolderId });
      }
      if (nextFolderId) {
        await addMeeting.mutateAsync({ summaryFile, folderId: nextFolderId });
      }
    } catch (error) {
      setLocalFolderId(previousFolderId);
      setFolderError(getErrorMessage(error));
    }
  };

  const handleValueChange = (value: string) => {
    if (value === FOLDER_NEW) {
      setFolderError(null);
      setCreatingFolder(true);
      setTimeout(() => newFolderInputRef.current?.focus(), 50);
      return;
    }
    void assignFolder(value === FOLDER_NONE ? null : value);
  };

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      setFolderError(null);
      return;
    }
    setFolderError(null);

    try {
      const result = await createFolder.mutateAsync({ name });
      setNewFolderName('');
      setCreatingFolder(false);
      await assignFolder(result.folder.id);
    } catch (error) {
      setFolderError(getErrorMessage(error));
    }
  };

  if (creatingFolder) {
    return (
      <div className="space-y-1">
        <div className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm">
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitNewFolder(); }
              if (e.key === 'Escape') {
                setNewFolderName('');
                setFolderError(null);
                setCreatingFolder(false);
              }
            }}
            onBlur={() => void submitNewFolder()}
            placeholder="Folder name..."
            className="w-28 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        {folderError && <p className="text-xs text-destructive">{folderError}</p>}
      </div>
    );
  }

  const currentFolderLabel = currentFolder?.name ?? 'Add to folder';

  return (
    <div className="space-y-1">
      <Select
        value={localFolderId ?? FOLDER_NONE}
        onValueChange={handleValueChange}
      >
        <SelectPrimitive.Trigger asChild>
          <button type="button" className="mv-chip">
            {currentFolderLabel}
          </button>
        </SelectPrimitive.Trigger>
        <SelectContent align="start">
          <SelectItem value={FOLDER_NONE}>No folder</SelectItem>
          <SelectSeparator />
          {allFolders.map((f) => (
            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={FOLDER_NEW}>New folder...</SelectItem>
        </SelectContent>
      </Select>
      {folderError && <p className="text-xs text-destructive">{folderError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure formatting / parsing helpers
// ---------------------------------------------------------------------------

function formatDetailDate(info: { processed_at?: string; updated_at?: string }): string | undefined {
  const raw = info.processed_at ?? info.updated_at;
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function formatEventTime(event: CalendarEvent): string {
  try {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    if (sameDay) {
      return `${start.toLocaleDateString(undefined, dateFmt)} · ${start.toLocaleTimeString(undefined, timeFmt)} – ${end.toLocaleTimeString(undefined, timeFmt)}`;
    }
    return `${start.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${end.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
  } catch {
    return event.start;
  }
}

function findRelatedEvents(events: CalendarEvent[], meeting: Meeting): CalendarEvent[] {
  const processedAt = meeting.session_info.processed_at;
  if (!processedAt) return [];
  const processed = new Date(processedAt).getTime();
  if (Number.isNaN(processed)) return [];
  const windowMs = 4 * 60 * 60 * 1000;
  return events.filter((e) => {
    const start = new Date(e.start).getTime();
    const end = new Date(e.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return Math.abs(start - processed) <= windowMs || (processed >= start && processed <= end);
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v !== 'object' || v === null) return '';
      const obj = v as Record<string, unknown>;
      const desc = typeof obj.description === 'string' ? obj.description : '';
      const owner = typeof obj.owner === 'string' ? obj.owner : '';
      if (desc) return owner ? `${owner}: ${desc}` : desc;
      if (typeof obj.text === 'string') return obj.text;
      if (typeof obj.name === 'string') return obj.name;
      return '';
    })
    .filter(Boolean);
}

interface DiscussionArea {
  title: string;
  analysis?: string;
}

function asDiscussionAreas(value: unknown): DiscussionArea[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): DiscussionArea | null => {
      if (typeof v === 'string') return { title: v };
      if (typeof v !== 'object' || v === null) return null;
      const obj = v as Record<string, unknown>;
      const title = typeof obj.title === 'string' ? obj.title : '';
      const analysis = typeof obj.analysis === 'string' ? obj.analysis : undefined;
      if (!title && !analysis) return null;
      return { title: title || 'Discussion topic', analysis };
    })
    .filter((v): v is DiscussionArea => v !== null);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Something went wrong.';
}
