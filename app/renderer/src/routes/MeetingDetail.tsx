import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  CloudOff,
  Copy,
  Download,
  FileText,
  Folder as FolderIcon,
  Globe,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
} from '@/components/ui/select';
import {
  useMeeting,
  useReprocessMeeting,
  useDeleteMeeting,
  useGenerateReport,
  useSetActiveReport,
  useDeleteReport,
  meetingsKeys,
} from '@/hooks/useMeetings';
import { useTemplates } from '@/hooks/useTemplates';
import {
  useOrgSession,
  useShareToOrg,
  useOrgBackupState,
  useUnshareFromOrgBySummary,
} from '@/hooks/useOrg';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { useActiveMeeting } from '@/lib/askBarContext';
import { ipc, type Meeting, type Report, type Template } from '@/lib/ipc';
import { buildTranscriptBundle, defaultExportFilename } from '@/lib/transcriptBundle';
import { unwrap } from '@/lib/result';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { stripReasoning } from '@/lib/markdown';
import {
  pendingTitleRegens,
  streamCache,
  type StreamPhase,
} from '@/lib/meetingDetailState';

const LAST_OPENED_KEY = 'steno-last-opened-meeting';

// Cross-process sentinel: the export-transcript handler returns this exact error
// when the user dismisses the save dialog, which we treat as a silent no-op
// rather than a failure. Must match the producers' value (app/ipc-sentinels.js,
// mirrored in the mock IPC) and app/docs/ipc-contract.md — the renderer is bundled
// separately and can't require that CJS module, so the contract doc is the source
// of truth that keeps them aligned.
const EXPORT_CANCELED_ERROR = 'canceled';

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
      ) : meeting.isError ? (
        <div className="space-y-4 text-center">
          <h1 className="mv-title">Couldn't load note.</h1>
          <p className="text-[17px] leading-[1.55]" style={{ color: 'var(--fg-2)' }}>
            {(meeting.error as Error)?.message ?? 'An error occurred loading this note.'}
          </p>
          <button
            type="button"
            className="mv-chip"
            onClick={() => navigate('/meetings')}
          >
            Back to meetings
          </button>
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
  const generateReport = useGenerateReport();
  const setActiveReport = useSetActiveReport();
  const deleteReport = useDeleteReport();
  const { templates } = useTemplates();
  const orgSession = useOrgSession();
  const shareToOrg = useShareToOrg();
  const backupState = useOrgBackupState(orgSession.data?.signedIn ? summaryFile : null);
  const unshareFromOrg = useUnshareFromOrgBySummary();
  const [unshareOpen, setUnshareOpen] = React.useState(false);
  const [shareError, setShareError] = React.useState<string | null>(null);

  const isShared = backupState.data?.shared ?? false;
  const isSharing = shareToOrg.isPending;
  const isUnsharing = unshareFromOrg.isPending;
  // A persisted upload failure on a note that never landed — surfaced as a
  // "Backup failed · Retry" affordance so an auto-backup that silently failed
  // (e.g. behind a corporate proxy) is visible and one-click retryable.
  const backupFailed = !isShared && Boolean(backupState.data?.failed_at);
  const backupError = backupState.data?.error ?? null;

  const onShareToOrg = async () => {
    setShareError(null);
    const title = meeting.session_info.name || 'Untitled note';
    // Body = structured summary markdown (same as local detail page).
    // Transcript ships as a separate S3 artifact so the org viewer can
    // toggle it via the side panel rather than rendering it inline below
    // the summary. Diarised text (with [You]/[Others] tags) is preferred
    // when available so the org viewer gets the speaker-attributed view.
    const body = composeShareBody(meeting);
    const transcript = pickTranscriptForShare(meeting);
    try {
      await shareToOrg.mutateAsync({ title, body, transcript, visibility: 'org', summaryFile });
      // Successful share — useShareToOrg invalidates the backup-state
      // query, so the button flips to "Unshare" on the next render.
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    }
  };

  const onUnshareFromOrg = async () => {
    setShareError(null);
    try {
      await unshareFromOrg.mutateAsync(summaryFile);
      setUnshareOpen(false);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
    }
  };
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
  const [chunkProgress, setChunkProgress] = React.useState<{ step: number; total: number } | null>(null);
  const [reprocessFailed, setReprocessFailed] = React.useState(false);
  const qc = useQueryClient();

  // Report switch: null = the structured Standard summary, otherwise the id of
  // a generated report in meeting.reports. Seeded from the meeting's persisted
  // active_report so reopening a note lands on whatever was last viewed.
  const reports = meeting.reports ?? [];
  const [activeReportId, setActiveReportId] = React.useState<string | null>(
    meeting.active_report ?? null,
  );
  const activeReport = activeReportId
    ? reports.find((r) => r.id === activeReportId) ?? null
    : null;
  // meeting.active_report is the source of truth (the switch persists it). Re-sync
  // local state whenever it changes so a reprocess (backend clears it to null)
  // can't leave the UI showing a stale report. Idempotent for user clicks.
  React.useEffect(() => {
    setActiveReportId(meeting.active_report ?? null);
  }, [meeting.active_report]);
  // When a report generation finishes, summaryComplete fires for THIS meeting
  // and we want to land on the freshly-created report. The IPC stream doesn't
  // carry the new report id, so we flag "the active stream is a report" and,
  // on complete, refetch + adopt the meeting's refreshed active_report.
  const generatingReportRef = React.useRef(false);

  React.useEffect(() => {
    streamCache.set(summaryFile, { text: streamText, phase: streamPhase });
  }, [summaryFile, streamText, streamPhase]);

  React.useEffect(() => {
    const sessionName = info.name;
    const offChunk = ipc().on.summaryChunk((e) => {
      if (e.summaryFile !== summaryFile) return;
      setStreamPhase((prev) => (prev === 'analyzing' ? 'generating' : prev));
      setStreamText((prev) => prev + e.chunk);
    });
    const offComplete = ipc().on.summaryComplete((e) => {
      if (e.summaryFile !== summaryFile) return;
      if (!e.success) {
        setStreamPhase('idle');
        setChunkProgress(null);
        if (e.report) {
          // A failed report generation is not a reprocess/model-memory failure.
          // Keyed on the event's `report` flag (not the local ref) so it's
          // correct regardless of summary-complete vs processing-complete order.
          generatingReportRef.current = false;
          setStreamText('');
          streamCache.delete(summaryFile);
        } else {
          setReprocessFailed(true);
        }
        return;
      }
      setStreamPhase('done');
      // Report generation reuses the summary stream. On success, refetch this
      // meeting so reports[]/active_report refresh, then land on the new report
      // (the backend marks it active) once the fresh detail payload arrives.
      if (generatingReportRef.current) {
        generatingReportRef.current = false;
        void qc
          .invalidateQueries({ queryKey: meetingsKeys.detail(summaryFile) })
          .then(() => {
            const fresh = qc.getQueryData<Meeting>(meetingsKeys.detail(summaryFile));
            if (fresh?.active_report) setActiveReportId(fresh.active_report);
          });
        setChunkProgress(null);
        setTimeout(() => {
          setStreamText('');
          setStreamPhase('idle');
          streamCache.delete(summaryFile);
        }, 400);
      }
    });
    const offProcessing = ipc().on.processingComplete((e) => {
      if (e.sessionName !== sessionName) return;
      setChunkProgress(null);
      if (!e.success) {
        setStreamPhase('idle');
        if (e.report) {
          // Terminal event of a failed report generation (e.g. non-zero exit
          // with no STREAM_ERROR). Roll back without the reprocess banner.
          generatingReportRef.current = false;
          setStreamText('');
          streamCache.delete(summaryFile);
        } else {
          setReprocessFailed(true);
        }
        return;
      }
      void qc.invalidateQueries({ queryKey: meetingsKeys.all });
      setTimeout(() => {
        setStreamText('');
        setStreamPhase('idle');
        streamCache.delete(summaryFile);
      }, 400);
    });
    const offProgress = ipc().on.processingProgress((e) => {
      // Ignore progress from a different meeting's concurrent reprocess — without
      // this scope check this view would render another meeting's map/reduce step.
      // Scoped on summaryFile (unique) rather than the display name (shareable).
      if (e.summaryFile !== summaryFile) return;
      const mapMatch = e.line.match(/^PROGRESS:summarize:(\d+)\/(\d+)$/);
      if (mapMatch) {
        setChunkProgress({ step: parseInt(mapMatch[1]), total: parseInt(mapMatch[2]) });
      } else if (e.line === 'PROGRESS:summarize:reducing') {
        setChunkProgress(null);
      }
    });
    return () => {
      offChunk();
      offComplete();
      offProcessing();
      offProgress();
    };
  }, [info.name, summaryFile, qc]);

  // Non-Standard templates only — the locked `standard` template drives the
  // structured summary, not an on-demand report.
  const reportTemplates = templates.filter((t) => !t.locked);

  const onGenerateReport = (templateId: string) => {
    setStreamText('');
    setStreamPhase('analyzing');
    setChunkProgress(null);
    setReprocessFailed(false);
    generatingReportRef.current = true;
    streamCache.set(summaryFile, { text: '', phase: 'analyzing' });
    generateReport.mutate(
      { summaryFile, templateId },
      {
        // Failures before the first stream event (e.g. the backend never starts
        // streaming) won't emit summary-complete, so roll the UI back here instead
        // of stranding it in the analyzing state.
        onError: () => {
          generatingReportRef.current = false;
          setStreamPhase('idle');
          setStreamText('');
          setChunkProgress(null);
          streamCache.delete(summaryFile);
        },
      },
    );
  };

  const startReprocess = () => {
    setStreamText('');
    setStreamPhase('analyzing');
    setChunkProgress(null);
    setReprocessFailed(false);
    streamCache.set(summaryFile, { text: '', phase: 'analyzing' });
    reprocess.mutate(
      { summaryFile, regenTitle: false, name: info.name },
      {
        // A rejection here means the IPC call itself failed (e.g. the backend
        // never spawned) BEFORE any processing-complete/summary-complete event
        // could fire to roll the UI back — without this the analyzing/streaming
        // state would be stuck forever with no way to retry (mirrors
        // onGenerateReport's onError below).
        onError: () => {
          setStreamPhase('idle');
          setStreamText('');
          setChunkProgress(null);
          streamCache.delete(summaryFile);
          setReprocessFailed(true);
        },
      },
    );
  };

  // Persist the choice so it survives navigation (B1 review: active_report not
  // persisted). `null` selects the structured Standard summary → 'standard'.
  const onSelectReport = (id: string | null) => {
    setActiveReportId(id);
    setActiveReport.mutate({ summaryFile, reportId: id ?? 'standard' });
  };

  const onDeleteReport = (reportId: string) => {
    if (activeReportId === reportId) setActiveReportId(null);
    deleteReport.mutate({ summaryFile, reportId });
  };

  const [copiedTranscript, setCopiedTranscript] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  // Built once per meeting — the transcript can be large, and it's read on every
  // render for the buttons' disabled state as well as in both handlers.
  const transcriptBundle = React.useMemo(() => buildTranscriptBundle(meeting), [meeting]);

  // Await the write and only flip to "Copied" once it actually succeeds — a
  // rejected clipboard (permission denied, no focus) must not show a false
  // success. The transcript bundle is large and the only thing a user pastes
  // into an LLM, so a silent miscopy is worse here than for the small notes copy.
  const copyTranscriptForAi = async () => {
    if (!transcriptBundle) return;
    setExportError(null);
    try {
      await navigator.clipboard.writeText(transcriptBundle);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1500);
    } catch (error) {
      setExportError(`Couldn't copy transcript: ${getErrorMessage(error)}`);
    }
  };

  // Save writes a file, which can genuinely fail — so unlike the copy paths we
  // surface a real failure. A user-cancelled dialog is not an error (the handler
  // returns error: EXPORT_CANCELED_ERROR) and stays silent.
  const saveTranscript = async () => {
    if (!transcriptBundle) return;
    setExportError(null);
    try {
      const res = await ipc().meetings.exportTranscript(
        defaultExportFilename(meeting),
        transcriptBundle,
      );
      if (!res.success && res.error !== EXPORT_CANCELED_ERROR) {
        setExportError(`Couldn't save transcript: ${res.error || 'unknown error'}`);
      }
    } catch (error) {
      setExportError(`Couldn't save transcript: ${getErrorMessage(error)}`);
    }
  };

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
  const transcriptionFailed = Boolean(meeting.session_info.transcription_failed);
  const transcriptionError = meeting.session_info.error?.trim();
  // The real signal for "auto-summarize was off" (#258) — NOT `!summary`, which
  // also matches an older/imported meeting whose ## Summary section is empty or
  // unparsable for unrelated reasons and would otherwise be misclassified as
  // transcript-only.
  const notesNotGenerated = meeting.session_info.notes_generated === false;

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
                  label={copiedTranscript ? 'Copied' : 'Copy transcript'}
                  onClick={() => void copyTranscriptForAi()}
                  disabled={!transcriptBundle}
                >
                  {copiedTranscript ? <Check className="size-[13px]" /> : <FileText className="size-[13px]" />}
                </ActionIconButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {copiedTranscript ? 'Copied!' : 'Copy transcript'}
              </TooltipContent>
            </Tooltip>
            {/* Regenerate re-runs summarisation on the existing transcript.
                A transcription-failure note has no transcript, so reprocess
                would exit non-zero and strand the UI on a spinner — hide it
                until a real re-transcribe-from-audio retry ships. */}
            {!info.transcription_failed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ActionIconButton
                    label="Regenerate notes"
                    onClick={startReprocess}
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
            )}
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
              <PopoverContent align="end" className="w-56 p-1">
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
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                  style={{ color: 'var(--fg-1)' }}
                  onClick={() => void saveTranscript()}
                  disabled={!transcriptBundle}
                >
                  <Download className="size-[13px] shrink-0" style={{ color: 'var(--fg-2)' }} />
                  Save transcript as .md…
                </button>
                {orgSession.data?.signedIn && (
                  isShared ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                      style={{ color: 'var(--fg-1)' }}
                      onClick={() => setUnshareOpen(true)}
                      disabled={isUnsharing}
                      title={`Unshare from ${orgSession.data.orgId}`}
                    >
                      <Globe className="size-[13px] shrink-0" style={{ color: 'var(--fg-2)' }} />
                      {`Unshare from ${orgSession.data.orgId}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                      style={{ color: 'var(--fg-1)' }}
                      onClick={() => void onShareToOrg()}
                      // Disable while the persistent share state is still
                      // loading — otherwise a fast click during initial
                      // mount would treat the note as "not shared" and
                      // upload a duplicate against an already-shared note.
                      disabled={isSharing || backupState.isLoading}
                      title={`Share with ${orgSession.data.orgId}`}
                    >
                      <Globe className="size-[13px] shrink-0" style={{ color: 'var(--fg-2)' }} />
                      {isSharing
                        ? 'Sharing…'
                        : shareError
                          ? `Share failed: ${shareError}`
                          : `Share with ${orgSession.data.orgId}`}
                    </button>
                  )
                )}
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

        {exportError && (
          <p role="alert" className="text-[12.5px]" style={{ color: 'var(--danger)' }}>
            {exportError}
          </p>
        )}

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
          {/* Quiet, non-alarming backup status for org users — a calm
              metadata chip (not a red alert) that a user can click to retry.
              The failure is also written to the diagnostic log for support. */}
          {orgSession.data?.signedIn && backupFailed && (
            <ChipV2
              icon={<CloudOff className="size-[11px]" />}
              onClick={() => void onShareToOrg()}
              title={
                backupError
                  ? `Last backup failed: ${backupError}. Click to retry.`
                  : 'This note has not been backed up. Click to retry.'
              }
            >
              {isSharing ? 'Backing up…' : 'Not backed up'}
            </ChipV2>
          )}
        </div>

        {titleError && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {titleError}
          </p>
        )}
      </header>

      {streamPhase === 'idle' && (reports.length > 0 || reportTemplates.length > 0) && (
        <ReportSwitch
          reports={reports}
          activeReportId={activeReportId}
          onSelect={onSelectReport}
          onDelete={onDeleteReport}
          templates={reportTemplates}
          onGenerate={onGenerateReport}
          generating={generateReport.isPending}
        />
      )}
      {reprocessFailed && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--fg-2)',
          }}
        >
          Summary generation failed — the model may have run out of memory or context.
          Try switching to a smaller model like <strong style={{ color: 'var(--fg-1)' }}>Gemma 4 E2B</strong> in Settings.
        </div>
      )}
      {streamPhase !== 'idle' ? (
        <StreamingView text={streamText} phase={streamPhase} chunkProgress={chunkProgress} />
      ) : activeReport ? (
        <section
          className="stream-markdown"
          data-testid="report-content"
          style={{ color: 'var(--fg-1)', maxWidth: '72ch' }}
        >
          <ReactMarkdown>{stripReasoning(activeReport.content)}</ReactMarkdown>
        </section>
      ) : (
        <div className="flex flex-col gap-9">
          {transcriptionFailed ? (
            <section
              className="flex flex-col gap-2 rounded-lg p-4"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle, var(--surface-raised))',
              }}
              data-testid="transcription-failed-notice"
            >
              <div
                className="text-[15px] font-medium"
                style={{ color: 'var(--fg-1)' }}
              >
                Transcription failed
              </div>
              <p
                className="text-[14px] leading-[1.6]"
                style={{ color: 'var(--fg-2)', maxWidth: '64ch' }}
              >
                No notes could be generated for this recording. Your audio was
                preserved (not deleted), so nothing was lost.
              </p>
              {transcriptionError && (
                <p
                  className="text-[12.5px] leading-[1.5]"
                  style={{ color: 'var(--fg-2)', opacity: 0.8 }}
                >
                  Details: {transcriptionError}
                </p>
              )}
            </section>
          ) : summary ? (
            <section className="flex flex-col gap-3">
              <SectionTitle>Summary</SectionTitle>
              <div data-testid="tab-summary-content">
                {stripReasoning(summary).split(/\n{2,}/).map((para, i) => (
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
          ) : notesNotGenerated && meeting.transcript ? (
            <section
              className="flex flex-col items-start gap-2 rounded-lg p-4"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle, var(--surface-raised))',
              }}
              data-testid="no-notes-yet"
            >
              <div
                className="text-[15px] font-medium"
                style={{ color: 'var(--fg-1)' }}
              >
                No notes yet
              </div>
              <p
                className="text-[14px] leading-[1.6]"
                style={{ color: 'var(--fg-2)', maxWidth: '64ch' }}
              >
                This recording was transcribed but notes were not generated
                automatically. Copy or save the transcript from the actions
                above, or generate notes whenever you like.
              </p>
              <Button
                className="mt-1"
                data-testid="generate-notes-cta"
                onClick={startReprocess}
                disabled={reprocess.isPending || streamPhase !== 'idle'}
              >
                Generate notes
              </Button>
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

      <Dialog open={unshareOpen} onOpenChange={setUnshareOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Unshare from {orgSession.data?.signedIn ? orgSession.data.orgId : 'your org'}?
            </DialogTitle>
            <DialogDescription>
              The shared copy will be removed from your organisation. Your
              local note stays on this device. You can re-share at any time.
            </DialogDescription>
          </DialogHeader>
          {shareError && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {shareError}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={isUnsharing}
              onClick={() => void onUnshareFromOrg()}
            >
              {isUnsharing ? 'Unsharing…' : 'Unshare'}
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
  title?: string;
}

function ChipV2({ icon, children, onClick, title }: ChipV2Props) {
  return (
    <button
      type="button"
      className="mv-chip"
      onClick={onClick}
      title={title}
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
// Report switch — segmented pills (Standard + one per generated report) plus a
// "Generate report" dropdown of the non-Standard templates. Controls which
// body the detail view renders; generation reuses the summary stream.
// ---------------------------------------------------------------------------

interface ReportSwitchProps {
  reports: Report[];
  activeReportId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (reportId: string) => void;
  templates: Template[];
  onGenerate: (templateId: string) => void;
  generating: boolean;
}

function ReportSwitch({
  reports,
  activeReportId,
  onSelect,
  onDelete,
  templates,
  onGenerate,
  generating,
}: ReportSwitchProps) {
  const [open, setOpen] = React.useState(false);
  // Report pending deletion → drives the confirmation dialog.
  const [deleteTarget, setDeleteTarget] = React.useState<Report | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="report-switch">
      <ReportPill active={activeReportId === null} onClick={() => onSelect(null)}>
        Standard
      </ReportPill>
      {reports.map((r) => {
        const when = formatReportDate(r.created_at);
        const meta = [r.model, when].filter(Boolean).join(' · ');
        return (
          <ReportPill
            key={r.id}
            active={activeReportId === r.id}
            onClick={() => onSelect(r.id)}
            onDelete={() => setDeleteTarget(r)}
            title={meta || undefined}
          >
            <span className="flex flex-col items-start leading-tight">
              <span>{r.template_name}</span>
              {meta && (
                <span
                  className="text-[10.5px]"
                  style={{ color: 'var(--fg-2)', fontWeight: 400 }}
                >
                  {meta}
                </span>
              )}
            </span>
          </ReportPill>
        );
      })}
      {templates.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="generate-report-trigger"
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
              style={{
                color: 'var(--fg-2)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <FileText className="size-[12px]" />
              {generating ? 'Generating…' : 'Generate report'}
              <ChevronDown className="size-[12px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{ color: 'var(--fg-1)' }}
                onClick={() => {
                  setOpen(false);
                  onGenerate(t.id);
                }}
              >
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={
          deleteTarget ? `Delete report "${deleteTarget.template_name}"?` : ''
        }
        description="This permanently deletes this generated report. The transcript and other reports are not affected."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!deleteTarget) return;
          onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function ReportPill({
  active,
  onClick,
  onDelete,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full transition-colors"
      style={{
        color: active ? 'var(--fg-1)' : 'var(--fg-2)',
        background: active ? 'var(--surface-raised)' : 'transparent',
        border: '1px solid var(--border-subtle)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={active}
        className="inline-flex items-center rounded-full py-1 pl-3 text-[12.5px]"
        style={{ paddingRight: onDelete ? '0.375rem' : '0.75rem' }}
      >
        {children}
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label="Delete report"
          title="Delete report"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="mr-1.5 inline-flex items-center rounded-full p-0.5 text-[color:var(--fg-2)] transition-colors hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger)]"
        >
          <Trash2 className="size-[11px]" />
        </button>
      )}
    </span>
  );
}

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

function StreamingView({ text, phase, chunkProgress }: { text: string; phase: StreamPhase; chunkProgress?: { step: number; total: number } | null }) {
  const blocks = parseMarkdownBlocks(stripReasoning(text));
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

  const indicatorLabel = chunkProgress
    ? `Summarising part ${chunkProgress.step}/${chunkProgress.total}`
    : phase === 'analyzing'
      ? 'Analysing transcript'
      : 'Generating notes';

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

// Compact date for the report-pill secondary line (e.g. "Jun 23"). Kept
// terser than formatDetailDate so the pill stays small.
function formatReportDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

/** Pick which transcript flavour to ship to org. Diarised text (with
 *  [You]/[Others] tags) preferred when available so org viewers get the
 *  speaker-attributed view; falls back to the plain transcript. Returns
 *  an empty string for meetings with no transcript at all, which the
 *  upload path treats as "skip the second presign+PUT". Kept here next
 *  to composeShareBody so manual-share (MeetingDetail) and auto-backup
 *  (useRecording) can't drift out of sync. */
export function pickTranscriptForShare(meeting: Meeting): string {
  if (meeting.is_diarised && meeting.diarised_text) return meeting.diarised_text;
  return meeting.transcript ?? '';
}

/** Compose the markdown body that will be uploaded to S3 when sharing
 *  a local note. Mirrors what the local note view renders (minus the raw
 *  transcript) so colleagues see the same structured summary. */
export function composeShareBody(meeting: Meeting): string {
  const sections: string[] = [];

  const summary = meeting.summary ? stripReasoning(meeting.summary).trim() : undefined;
  if (summary) {
    sections.push(`## Summary\n\n${summary}`);
  }

  const topics = asDiscussionAreas(meeting.discussion_areas);
  if (topics.length) {
    const block = topics
      .map((t) => {
        const title = (t.title || '').trim();
        const analysis = (t.analysis || '').trim();
        if (title && analysis) return `### ${title}\n\n${analysis}`;
        return `### ${title || analysis}`;
      })
      .join('\n\n');
    sections.push(`## Key topics\n\n${block}`);
  }

  const keyPoints = (meeting.key_points ?? []).filter(Boolean);
  if (keyPoints.length) {
    sections.push(
      `## Key points\n\n${keyPoints.map((kp) => `- ${kp}`).join('\n')}`,
    );
  }

  const actionItems = asStringArray(meeting.action_items);
  if (actionItems.length) {
    sections.push(
      `## Action items\n\n${actionItems.map((ai) => `- ${ai}`).join('\n')}`,
    );
  }

  // Deliberately do NOT fall back to meeting.transcript here: the raw
  // transcript is excluded from shared notes by design (limits blast radius
  // if the bucket is ever leaked, and matches what local meeting views
  // already show in the body — summary, not transcript). If every structured
  // field is empty, return empty rather than secretly upload the transcript.
  return sections.join('\n\n');
}
