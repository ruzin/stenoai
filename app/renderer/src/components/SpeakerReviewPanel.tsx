import * as React from 'react';
import { Check, ChevronDown, Loader2, Play, Square, Trash2, UserPlus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useSpeakerSuggestions,
  usePersonProfiles,
  useConfirmSpeaker,
  useGetSpeakerSampleAudio,
  useDeletePersonProfile,
  meetingStemFromSummaryFile,
} from '@/hooks/useSpeakerSuggestions';
import type { PersonProfile, SpeakerSuggestion } from '@/lib/ipc';

interface SpeakerReviewPanelProps {
  summaryFile: string;
  isDiarised: boolean;
}

interface Row {
  channel: string;
  diarizationSpeakerId: string;
  suggestion: SpeakerSuggestion;
}

function rowKey(row: Pick<Row, 'channel' | 'diarizationSpeakerId'>): string {
  return `${row.channel}:${row.diarizationSpeakerId}`;
}

/** confirmed_by_user (a real SpeakerPrototype match) always wins over the
 * distance-based status/suggested_name -- otherwise a row can show "Might
 * be X" or even "Unidentified speaker" right next to a *separate*
 * "confirmed" line for the same X, which reads as a flat contradiction. A
 * human already confirmed who this is; the ranking that produced the
 * original suggestion is no longer the interesting fact about this row. */
function suggestionLabel(suggestion: SpeakerSuggestion): string {
  if (suggestion.confirmed_by_user) {
    return `✓ Confirmed as ${suggestion.confirmed_by_user}`;
  }
  if (suggestion.status === 'confirmed' && suggestion.suggested_name) {
    return `Likely ${suggestion.suggested_name}`;
  }
  const topCandidate = suggestion.candidates[0];
  if (suggestion.status === 'possible' && topCandidate) {
    return `Might be ${topCandidate.display_name}`;
  }
  return 'Unidentified speaker';
}

// Mirrors Config._person_name_taken's case/whitespace-insensitive
// comparison (src/config.py) -- lets the "New person" dialog warn BEFORE
// a round trip to the backend, which enforces the same rule as the real
// source of truth (defense against a stale/racy profiles list here).
function namesCollide(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// "mic" is always the device owner's own recording side (in-person audio);
// "system" is loopback capture of the other call participant(s) -- see
// determine_recording_type (src/speaker_suggestions.py) for the same
// mic->in_person / system->remote mapping this mirrors.
function channelLabel(channel: string): string {
  if (channel === 'mic') return 'your mic';
  if (channel === 'system') return 'the call';
  return channel;
}

/** Where in the recording to go listen, so a human reviewing an
 * "Unidentified speaker" row has something to act on -- without this
 * there's no way to know who a cluster with no suggestion actually is. */
function identificationHint(channel: string, suggestion: SpeakerSuggestion): string {
  const parts = [channelLabel(channel)];
  if (suggestion.first_timestamp) parts.push(`first at ${suggestion.first_timestamp}`);
  parts.push(
    `${Math.round(suggestion.speech_duration_seconds)}s across ${suggestion.segment_count} turn${suggestion.segment_count === 1 ? '' : 's'}`,
  );
  return parts.join(' · ');
}

function base64ToBlobUrl(base64: string, mimeType = 'audio/wav'): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

interface PlaySampleButtonProps {
  meetingStem: string;
  channel: string;
  diarizationSpeakerId: string;
  disabled?: boolean;
}

/** Play/stop toggle for a cluster's longest-segment audio sample -- mirrors
 * pasrom/meeting-transcriber's SpeakerNamingView.swift play button exactly
 * (fetch-on-click, toggle icon, auto-reset when playback ends). Fetched via
 * a mutation (not cached) since nothing needs to stay fresh in the
 * background for a clip a human explicitly triggers. */
function PlaySampleButton({ meetingStem, channel, diarizationSpeakerId, disabled }: PlaySampleButtonProps) {
  const getSample = useGetSpeakerSampleAudio();
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };

  React.useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (playing) {
      stop();
      return;
    }
    const result = await getSample.mutateAsync({ meetingStem, channel, diarizationSpeakerId });
    const url = base64ToBlobUrl(result.audio_base64);
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setPlaying(false);
    };
    audioRef.current = audio;
    setPlaying(true);
    void audio.play();
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={playing ? 'Stop sample' : 'Play sample'}
      title={playing ? 'Stop sample' : 'Play sample'}
      disabled={disabled || getSample.isPending}
      onClick={() => void toggle()}
      data-testid={`speaker-play-${channel}:${diarizationSpeakerId}`}
    >
      {getSample.isPending ? (
        <Loader2 className="size-[13px] animate-spin" />
      ) : playing ? (
        <Square className="size-[13px]" />
      ) : (
        <Play className="size-[13px]" />
      )}
    </Button>
  );
}

/**
 * Per-meeting review panel for diarized speaker clusters: shows a suggested
 * real name (if any) per cluster with Approve / Change / New person / Keep
 * generic actions. Lives inside MeetingDetail's content flow, gated on
 * `is_diarised` -- see the speaker_identification plan doc's Phase 4.
 *
 * Rows with status "none" AND zero candidates (nothing actionable at all --
 * in practice this is almost always the device owner's own mic-channel
 * cluster, which never matches a named PersonProfile) are hidden entirely.
 * Rows flagged `is_likely_artifact` (the real-data-validated echo/crosstalk
 * pattern -- see SUGGESTION_MIN_AVG_TURN_SECONDS) are hidden BY DEFAULT but
 * still reachable via a "Show N filtered rows" toggle -- never silently
 * dropped, since a human might legitimately want to review one (e.g. a
 * real quiet third participant).
 */
type ConfirmFeedback = { message: string };

export function SpeakerReviewPanel({ summaryFile, isDiarised }: SpeakerReviewPanelProps) {
  const meetingStem = meetingStemFromSummaryFile(summaryFile);
  const suggestionsQuery = useSpeakerSuggestions(isDiarised ? meetingStem : null);
  const profilesQuery = usePersonProfiles();
  const confirmSpeaker = useConfirmSpeaker();
  const deleteProfile = useDeletePersonProfile();

  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [changeOpenFor, setChangeOpenFor] = React.useState<string | null>(null);
  const [newPersonRow, setNewPersonRow] = React.useState<Row | null>(null);
  const [newPersonName, setNewPersonName] = React.useState('');
  const [showFiltered, setShowFiltered] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PersonProfile | null>(null);
  // Rows with status "none" and zero candidates are normally hidden as
  // "nothing actionable" (in practice almost always the device owner's own
  // mic-channel cluster). But deleting a person clears suggested_person_id/
  // candidates for any cluster that pointed at them, which would otherwise
  // make that row -- which the user was just looking at -- vanish with no
  // way to give it a new name. Force those specific rows to stay visible
  // for the rest of this session once that's happened.
  const [keepVisible, setKeepVisible] = React.useState<Set<string>>(new Set());
  // Error acknowledgment only -- a SUCCESSFUL confirm needs no separate
  // feedback state: useConfirmSpeaker's onSuccess awaits the suggestions
  // refetch before resolving, so by the time this fires the row's own
  // label already reads "✓ Confirmed as X" from the real confirmed_by_user
  // field. A parallel success flag here would just be a second, redundant
  // (and unmount-fragile) copy of the same fact. Cleared whenever a fresh
  // confirm attempt starts on that row.
  const [feedback, setFeedback] = React.useState<Map<string, ConfirmFeedback>>(new Map());

  if (!isDiarised || !meetingStem) return null;

  const rows: Row[] = [];
  const channels = suggestionsQuery.data?.channels ?? {};
  for (const channel of Object.keys(channels)) {
    for (const [diarizationSpeakerId, suggestion] of Object.entries(channels[channel])) {
      const key = rowKey({ channel, diarizationSpeakerId });
      const nothingActionable = suggestion.status === 'none' && suggestion.candidates.length === 0;
      if (nothingActionable && !keepVisible.has(key)) continue;
      rows.push({ channel, diarizationSpeakerId, suggestion });
    }
  }
  rows.sort(
    (a, b) => a.channel.localeCompare(b.channel) || a.diarizationSpeakerId.localeCompare(b.diarizationSpeakerId),
  );
  const notDismissed = rows.filter((row) => !dismissed.has(rowKey(row)));
  const artifactRows = notDismissed.filter((row) => row.suggestion.is_likely_artifact);
  const primaryRows = notDismissed.filter((row) => !row.suggestion.is_likely_artifact);
  const visibleRows = showFiltered ? notDismissed : primaryRows;
  const recordingAvailable = suggestionsQuery.data?.recording_available ?? false;

  if (!suggestionsQuery.data || notDismissed.length === 0) return null;

  const duplicateProfile = newPersonName.trim()
    ? (profilesQuery.data ?? []).find((p) => namesCollide(p.display_name, newPersonName))
    : undefined;

  const confirm = (row: Row, args: { personId?: string; newPersonName?: string }) => {
    const key = rowKey(row);
    setFeedback((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    confirmSpeaker.mutate(
      {
        meetingStem,
        channel: row.channel,
        diarizationSpeakerId: row.diarizationSpeakerId,
        personId: args.personId,
        newPersonName: args.newPersonName,
        summaryFile,
      },
      {
        onError: (error) => {
          setFeedback((prev) => new Map(prev).set(key, { message: error.message }));
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-3" data-testid="speaker-review-panel">
      <h2
        className="text-[13px] font-semibold tracking-[0.01em]"
        style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', margin: 0 }}
      >
        Speakers
      </h2>
      <div className="flex flex-col gap-1.5">
        {visibleRows.map((row) => {
          const key = rowKey(row);
          const isPending =
            confirmSpeaker.isPending &&
            confirmSpeaker.variables?.channel === row.channel &&
            confirmSpeaker.variables?.diarizationSpeakerId === row.diarizationSpeakerId;
          return (
            <div
              key={key}
              data-testid={`speaker-row-${key}`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={`text-[13.5px] ${row.suggestion.confirmed_by_user ? 'font-medium' : ''}`}
                  style={{ color: 'var(--fg-1)' }}
                >
                  {suggestionLabel(row.suggestion)}
                </span>
                <span className="text-[11.5px]" style={{ color: 'var(--fg-2)' }}>
                  {identificationHint(row.channel, row.suggestion)}
                </span>
                {row.suggestion.sample_text && (
                  <span
                    className="truncate text-[11.5px] italic"
                    style={{ color: 'var(--fg-2)' }}
                    title={row.suggestion.sample_text}
                  >
                    “{row.suggestion.sample_text}”
                  </span>
                )}
                {feedback.get(key) && (
                  <span
                    className="text-[11.5px] font-medium"
                    style={{ color: 'var(--danger)' }}
                    data-testid={`speaker-feedback-${key}`}
                  >
                    {`Couldn't confirm: ${feedback.get(key)!.message}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {recordingAvailable && (
                  <PlaySampleButton
                    meetingStem={meetingStem}
                    channel={row.channel}
                    diarizationSpeakerId={row.diarizationSpeakerId}
                    disabled={isPending}
                  />
                )}
                {/* Hidden once confirmed_by_user is set -- re-approving an
                    already-confirmed cluster is a no-op that changes
                    nothing visible, which reads as broken. Change/New
                    person stay available to correct a wrong confirmation. */}
                {row.suggestion.status !== 'none' &&
                  row.suggestion.suggested_person_id &&
                  !row.suggestion.confirmed_by_user && (
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isPending}
                      onClick={() => confirm(row, { personId: row.suggestion.suggested_person_id as string })}
                      data-testid={`speaker-approve-${key}`}
                    >
                      <Check className="size-[13px]" />
                      Approve
                    </Button>
                  )}
                <Popover
                  open={changeOpenFor === key}
                  onOpenChange={(open) => setChangeOpenFor(open ? key : null)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      data-testid={`speaker-change-${key}`}
                    >
                      Change
                      <ChevronDown className="size-[13px]" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[200px] p-1">
                    {(profilesQuery.data ?? []).length === 0 ? (
                      <div className="px-2 py-1.5 text-[12.5px]" style={{ color: 'var(--fg-2)' }}>
                        No known people yet
                      </div>
                    ) : (
                      (profilesQuery.data ?? []).map((profile) => (
                        <div key={profile.person_id} className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setChangeOpenFor(null);
                              confirm(row, { personId: profile.person_id });
                            }}
                            className="flex min-w-0 flex-1 items-center truncate rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
                            style={{ color: 'var(--fg-1)' }}
                          >
                            {profile.display_name}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${profile.display_name}`}
                            title={`Delete ${profile.display_name}`}
                            onClick={() => {
                              setChangeOpenFor(null);
                              setDeleteTarget(profile);
                            }}
                            className="flex shrink-0 items-center rounded-md p-1.5 transition-colors hover:bg-[color:var(--surface-hover)]"
                            style={{ color: 'var(--fg-2)' }}
                            data-testid={`speaker-delete-person-${profile.person_id}`}
                          >
                            <Trash2 className="size-[13px]" />
                          </button>
                        </div>
                      ))
                    )}
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    setNewPersonName('');
                    setNewPersonRow(row);
                  }}
                  data-testid={`speaker-new-person-${key}`}
                >
                  <UserPlus className="size-[13px]" />
                  New person
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Keep generic label"
                  title="Keep generic label"
                  disabled={isPending}
                  onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                  data-testid={`speaker-keep-generic-${key}`}
                >
                  <X className="size-[13px]" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {artifactRows.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFiltered((prev) => !prev)}
          className="self-start text-[11.5px] underline-offset-2 hover:underline"
          style={{ color: 'var(--fg-2)' }}
          data-testid="speaker-toggle-filtered"
        >
          {showFiltered
            ? 'Hide filtered rows'
            : `Show ${artifactRows.length} filtered row${artifactRows.length === 1 ? '' : 's'}`}
        </button>
      )}

      <Dialog open={newPersonRow !== null} onOpenChange={(open) => !open && setNewPersonRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New person</DialogTitle>
            <DialogDescription>
              Give this speaker a name. Future recordings of them can then be suggested automatically.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            placeholder="e.g. Julian"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPersonRow && newPersonName.trim() && !duplicateProfile) {
                confirm(newPersonRow, { newPersonName: newPersonName.trim() });
                setNewPersonRow(null);
              }
            }}
            data-testid="speaker-new-person-input"
          />
          {duplicateProfile && (
            <p className="text-[12px]" style={{ color: 'var(--danger)' }} data-testid="speaker-new-person-duplicate">
              A person named "{duplicateProfile.display_name}" already exists -- use Change to pick them instead.
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              disabled={!newPersonName.trim() || Boolean(duplicateProfile)}
              onClick={() => {
                if (!newPersonRow || !newPersonName.trim() || duplicateProfile) return;
                confirm(newPersonRow, { newPersonName: newPersonName.trim() });
                setNewPersonRow(null);
              }}
              data-testid="speaker-new-person-submit"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.display_name}?` : ''}
        description="This removes them from every meeting's speaker suggestions and deletes their voice profile. This can't be undone."
        confirmLabel="Delete"
        destructive
        isPending={deleteProfile.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const affectedKeys = rows
            .filter((r) => r.suggestion.suggested_person_id === deleteTarget.person_id)
            .map(rowKey);
          await deleteProfile.mutateAsync(deleteTarget.person_id);
          if (affectedKeys.length > 0) {
            setKeepVisible((prev) => {
              const next = new Set(prev);
              affectedKeys.forEach((k) => next.add(k));
              return next;
            });
          }
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}
