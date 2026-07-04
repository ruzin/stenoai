import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
} from '@/lib/debugLogs';
import { ipc } from '@/lib/ipc';
import { redactDiagnostics } from '@/lib/redactDiagnostics';
import {
  useStoragePath,
  useAppVersion,
  useSystemAudioSupport,
  useSystemAudioSetting,
  useSilenceAutoStopSetting,
} from '@/hooks/useSettings';
import { useAiProvider } from '@/hooks/useAi';
import { useTranscriptionEngine } from '@/hooks/useModels';

export function DeveloperTab() {
  // Read from the global store so we get the full session backlog, not just
  // lines emitted after this tab mounted.
  const logs = React.useSyncExternalStore(
    subscribeDebugLogs,
    getDebugLogs,
    getDebugLogs,
  );

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // Keep the textarea pinned to the most recent line whenever new logs arrive.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Data for redaction (custom storage root) + the anonymized env header. All
  // already cached by other Settings surfaces, so these reads are free here.
  const storage = useStoragePath();
  const version = useAppVersion();
  const systemAudioSupport = useSystemAudioSupport();
  const systemAudio = useSystemAudioSetting();
  const silenceAutoStop = useSilenceAutoStopSetting();
  const engine = useTranscriptionEngine();
  const aiProvider = useAiProvider();

  // The custom storage root (only set when the user moved storage off the
  // default under-home location). It may live outside home, so redaction needs
  // the literal string; undefined means the home-dir rule already covers it.
  const storageRoot = storage.data?.custom_path ?? undefined;

  const copyLogs = () => {
    void navigator.clipboard.writeText(
      redactDiagnostics(logs, { storageRoot }).join('\n'),
    );
  };

  // Build the anonymized env header (no PII: provider TYPE not URL/key, no
  // telemetry id) + a blank line + the redacted buffer, and save it to a file
  // the user picks. Header values come from the same hooks the Settings/About
  // surfaces already use.
  const saveLogs = async () => {
    const platform = systemAudioSupport.data?.platform ?? '(unknown)';
    const osVersion = systemAudioSupport.data?.osVersion ?? '(unknown)';
    const header = [
      '# stenoai diagnostics',
      '# Paths, URLs and meeting titles are redacted. No account/telemetry id.',
      `app version: ${version.data?.version ?? '(unknown)'}`,
      `platform: ${platform}`,
      `os version: ${osVersion}`,
      `transcription engine: ${engine.data ?? '(unknown)'}`,
      `ai provider: ${aiProvider.data?.ai_provider ?? '(unknown)'}`,
      `system audio enabled: ${systemAudio.data ? 'yes' : 'no'}`,
      `silence auto-stop enabled: ${silenceAutoStop.data?.enabled ? 'yes' : 'no'}`,
      `silence auto-stop minutes: ${silenceAutoStop.data?.minutes ?? '(unknown)'}`,
    ];
    const body = redactDiagnostics(logs, { storageRoot });
    const content = [...header, '', ...body].join('\n');

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    await ipc().settings.saveDiagnostics(`stenoai-diagnostics-${stamp}.txt`, content);
  };

  const placeholder =
    'Steno debug console\nSession started — waiting for activity…\n';

  return (
    <section data-settings-tab="developer">
      <div className="flex items-baseline justify-between pb-2 pt-1">
        <div>
          <div
            className="text-[14px] font-medium"
            style={{ color: 'var(--fg-1)', marginBottom: 2 }}
          >
            Debug console
          </div>
          <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
            Real-time log output from backend processes.
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[13px]"
            onClick={clearDebugLogs}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[13px]"
            onClick={copyLogs}
            disabled={!logs.length}
          >
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[13px]"
            onClick={() => void saveLogs()}
            disabled={!logs.length}
          >
            Save
          </Button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        readOnly
        value={logs.length === 0 ? placeholder : logs.join('\n')}
        className="block w-full font-mono text-[12px]"
        style={{
          height: 340,
          padding: 16,
          lineHeight: 1.7,
          color: 'var(--fg-2)',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius)',
          resize: 'none',
        }}
      />
    </section>
  );
}
