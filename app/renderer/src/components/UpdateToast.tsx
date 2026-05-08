import * as React from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import { ipc } from '@/lib/ipc';

/**
 * Top-right toast that appears when electron-updater has finished
 * downloading a new release in the background. Click "Restart" to call
 * the main-side `install-update` IPC, which triggers `quitAndInstall` and
 * relaunches into the new version. Dismiss with × to hide for the rest
 * of the session — the next launch will surface it again if a newer
 * version is still pending.
 */
export function UpdateToast() {
  const [pendingVersion, setPendingVersion] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    return ipc().on.updateDownloaded((evt) => {
      setPendingVersion(evt.version);
      // A newer version arriving overrides any prior dismiss for this
      // session — the user dismissed v0.2.14, but v0.2.15 just landed.
      setDismissed(false);
    });
  }, []);

  if (!pendingVersion || dismissed) return null;

  return (
    <div
      className="pointer-events-auto fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px]"
      style={{
        background: 'var(--surface-raised)',
        color: 'var(--fg-1)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--font-sans)',
      }}
      role="status"
      aria-live="polite"
    >
      <ArrowDownToLine size={13} style={{ color: 'var(--fg-2)' }} />
      <span>
        Update <span className="tabular-nums">v{pendingVersion}</span> ready
      </span>
      <button
        type="button"
        onClick={() => ipc().updates.install()}
        className="ml-1 cursor-pointer rounded-full border-0 px-2.5 py-1 text-[12px] font-medium"
        style={{
          background: 'var(--fg-1)',
          color: 'var(--fg-inverse)',
        }}
      >
        Restart
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notification"
        className="ml-0.5 inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-1"
        style={{ color: 'var(--fg-2)' }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
