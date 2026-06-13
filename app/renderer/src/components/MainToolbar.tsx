import * as React from 'react';
import { FileAudio, MessageSquare, Moon, MoreHorizontal, Monitor, PanelLeftClose, PanelLeftOpen, PencilLine, Sun } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AudioWave } from '@/components/AudioWave';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  useSetSystemAudio,
  useSystemAudioSetting,
  useSystemAudioSupport,
} from '@/hooks/useSettings';
import type { RecordingStatus } from '@/hooks/useRecording';
import { useTheme } from '@/hooks/useTheme';
import { useImportAudio } from '@/hooks/useImportAudio';
import { useRoute, navigate } from '@/lib/router';
import { cn, isMac } from '@/lib/utils';

interface MainToolbarProps {
  recordingStatus: RecordingStatus;
  elapsedSeconds?: number;
  onToggleRecording: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function MainToolbar({
  recordingStatus,
  elapsedSeconds = 0,
  onToggleRecording,
  sidebarCollapsed,
  onToggleSidebar,
}: MainToolbarProps) {
  const isRecording =
    recordingStatus === 'recording' || recordingStatus === 'paused';
  const isPaused = recordingStatus === 'paused';
  const { resolved: resolvedTheme, setTheme } = useTheme();
  // Route-aware primary action. On chat routes the "+ New" affordance maps
  // to a new chat (navigates back to /chat entry). Everywhere else it's
  // the recording button. Recording always wins if a session is active —
  // we don't want a navigation to silently swallow a stop-recording click.
  // Processing of a previous note runs in the background queue and
  // doesn't gate this button.
  const route = useRoute();
  const isChatRoute = route === '/chat' || route.startsWith('/chat/');
  const showChatPrimary = isChatRoute && !isRecording;

  // Matches sb-top padding-left: 82px clears the macOS traffic lights; on
  // Windows/Linux there are none, so align to the sidebar's left edge.
  const toggleLeft = isMac ? 82 : 16;

  // Hoisted here (always mounted) so a long import's onSuccess refresh
  // still fires even if the user closes the options popover mid-import.
  const importAudio = useImportAudio();

  return (
    <div
      className="flex h-10 items-center justify-between gap-2 px-5 pt-2.5"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="ml-auto flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Toggle button lives here (inside a no-drag child of a drag ancestor)
            so Electron correctly computes the no-drag region even when the
            sidebar aside has pointer-events:none. position:fixed keeps it at
            the same screen coords as the sb-top button position. */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          style={{
            position: 'fixed',
            top: 14,
            left: toggleLeft,
            zIndex: 30,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          className="inline-flex h-[26px] w-7 items-center justify-center rounded-md text-[color:var(--fg-2)] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-[15px]" />
          ) : (
            <PanelLeftClose className="size-[15px]" />
          )}
        </button>
        <RecordingOptionsPopover importAudio={importAudio} disabled={isRecording} />
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label={
            resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }
          title={
            resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }
          className="inline-flex h-[26px] w-7 items-center justify-center rounded-md text-[color:var(--fg-2)] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="size-[15px]" />
          ) : (
            <Moon className="size-[15px]" />
          )}
        </button>
        <button
          type="button"
          onClick={showChatPrimary ? () => navigate('/chat') : onToggleRecording}
          className={cn('record-btn', isRecording && 'is-recording')}
          aria-label={
            isRecording
              ? 'Open recording in progress'
              : showChatPrimary
                ? 'New chat'
                : 'New note'
          }
          title={
            isRecording
              ? 'Open recording in progress'
              : showChatPrimary
                ? 'New chat'
                : 'New note'
          }
        >
          {isRecording ? (
            <>
              <span style={{ color: '#FFFFFF', display: 'inline-flex' }}>
                <AudioWave
                  active={!isPaused}
                  paused={isPaused}
                  bars={5}
                  height={12}
                  barWidth={2}
                  gap={2}
                />
              </span>
              <span
                className="tabular-nums"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              >
                {formatElapsed(elapsedSeconds)}
              </span>
              <span>{isPaused ? 'Paused' : 'Recording'}</span>
            </>
          ) : showChatPrimary ? (
            <>
              <MessageSquare className="size-[13px]" />
              New chat
            </>
          ) : (
            <>
              <PencilLine className="size-[13px]" />
              New note
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function RecordingOptionsPopover({
  importAudio,
  disabled,
}: {
  importAudio: UseMutationResult<boolean, Error, void>;
  disabled: boolean;
}) {
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const systemAudioSupport = useSystemAudioSupport();
  const enabled = systemAudio.data ?? false;
  // Show the toggle wherever loopback capture is available (macOS 14.4+ or
  // Windows 10+), not just on mac. Hidden while support is still loading or
  // on unsupported OSes.
  const showSystemAudio = systemAudioSupport.data?.supported === true;
  const experimental = systemAudioSupport.data?.experimental === true;
  // Controlled so the import action can close the popover when it fires — the
  // import's progress then shows as a processing row in the meeting list,
  // not in this (now closed) popover.
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Recording options"
          title="Recording options"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" data-recording-options>
        <div className="space-y-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Recording options</p>
            <p className="text-xs text-muted-foreground">
              Deep links and the tray menu also start and stop recording.
            </p>
          </div>

          {showSystemAudio && (
            <div
              className="flex items-start gap-3 rounded-md border p-3"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <Monitor className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="maintoolbar-system-audio"
                    className="text-sm font-medium"
                  >
                    Record system audio
                    {experimental && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Experimental
                      </span>
                    )}
                  </label>
                  <Switch
                    id="maintoolbar-system-audio"
                    checked={enabled}
                    disabled={systemAudio.isLoading || setSystemAudio.isPending}
                    onCheckedChange={(v) => setSystemAudio.mutate(v)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {experimental
                    ? 'Capture both sides of calls (experimental on Windows). Verify your first recording captures system audio.'
                    : 'Capture both sides of calls on macOS. Grants microphone permission on first use.'}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              importAudio.mutate();
            }}
            className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileAudio className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1 space-y-0.5">
              <p className="text-sm font-medium">Import audio file…</p>
              <p className="text-xs text-muted-foreground">
                {disabled
                  ? 'Stop the current recording to import a file.'
                  : 'Transcribe and summarise an existing recording. It will appear in the list while it processes.'}
              </p>
            </div>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, seconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(rem)}`;
  return `${pad(m)}:${pad(rem)}`;
}
