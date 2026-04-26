import * as React from 'react';
import { Mic, MoreHorizontal, Monitor, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
} from '@/hooks/useSettings';
import type { RecordingStatus } from '@/hooks/useRecording';
import { cn } from '@/lib/utils';

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

  // Matches sb-top padding-left (82px clears macOS traffic lights)
  const toggleLeft = 82;

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
        <RecordingOptionsPopover />
        <button
          type="button"
          onClick={onToggleRecording}
          className={cn('record-btn', isRecording && 'is-recording')}
          aria-label={
            isRecording ? 'Open recording in progress' : 'Start recording'
          }
          title={
            isRecording ? 'Open recording in progress' : 'Start recording'
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
          ) : (
            <>
              <Mic className="size-[13px]" />
              Start recording
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function RecordingOptionsPopover() {
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const enabled = systemAudio.data ?? false;

  return (
    <Popover>
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
                </label>
                <Switch
                  id="maintoolbar-system-audio"
                  checked={enabled}
                  disabled={systemAudio.isLoading || setSystemAudio.isPending}
                  onCheckedChange={(v) => setSystemAudio.mutate(v)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Capture both sides of calls on macOS. Grants microphone
                permission on first use.
              </p>
            </div>
          </div>
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
