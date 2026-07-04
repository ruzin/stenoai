import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
} from '@/lib/debugLogs';

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

  const copyLogs = () => {
    void navigator.clipboard.writeText(logs.join('\n'));
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
