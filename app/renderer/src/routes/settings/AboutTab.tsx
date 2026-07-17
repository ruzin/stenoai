import * as React from 'react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ipc } from '@/lib/ipc';
import { useAppVersion } from '@/hooks/useSettings';
import { COMPACT_BTN, SettingRow } from './primitives';

/** Plain external-link text (matches TemplatesTab's "learn more" link) for
 *  rows that just navigate out, rather than a bordered Button — keeps the
 *  bordered-button treatment reserved for in-page actions (Check for
 *  Updates, Restart to Update). */
function ExternalLinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[13px] underline underline-offset-2 hover:no-underline"
      style={{ color: 'var(--fg-1)' }}
    >
      {label}
      <ExternalLink className="size-3" />
    </button>
  );
}

// docs.stenoai.co/changelog (not github.com), so these go through the
// generic shell.openExternal channel rather than updates.openReleasePage,
// which is locked to the github.com origin (see main.js's open-release-page
// handler) for the contextual "View release" button below.
const CHANGELOG_URL = 'https://docs.stenoai.co/changelog';
const DISCORD_URL = 'https://discord.gg/DZ6vcQnxxu';
const GITHUB_URL = 'https://github.com/ruzin/stenoai';
const TERMS_URL = 'https://stenoai.co/terms.html';
const PRIVACY_URL = 'https://stenoai.co/privacy.html';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'error'; message: string }
  | { kind: 'up-to-date' }
  | { kind: 'update-available'; version: string; releaseUrl: string };

export function AboutTab() {
  const version = useAppVersion();
  const [checkState, setCheckState] = React.useState<CheckState>({ kind: 'idle' });
  const [downloadPercent, setDownloadPercent] = React.useState<number | null>(null);
  const [downloadedVersion, setDownloadedVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    const offAvailable = ipc().on.updateAvailable(() => {
      // Confirms the real background updater has started fetching this
      // version — the progress bar below is about to start moving.
      setDownloadPercent((p) => p ?? 0);
    });
    const offProgress = ipc().on.updateDownloadProgress((evt) => {
      setDownloadPercent(evt.percent);
    });
    const offDownloaded = ipc().on.updateDownloaded((evt) => {
      setDownloadPercent(null);
      setDownloadedVersion(evt.version);
    });
    return () => {
      offAvailable();
      offProgress();
      offDownloaded();
    };
  }, []);

  // The 'update-downloaded' event above only reaches a listener mounted at
  // the exact moment it fires — Settings tabs unmount on switch, so a
  // download finishing while the user is elsewhere would otherwise leave
  // About with no way to show "Restart to Update" again. Re-seed from main's
  // persisted state on every mount. Merge rather than overwrite: if the live
  // event above already set a version (e.g. it fired while this request was
  // in flight), a stale/null response here must not clobber it.
  React.useEffect(() => {
    let cancelled = false;
    void ipc()
      .updates.getStatus()
      .then((result) => {
        if (cancelled || !result.success || !result.downloadedVersion) return;
        setDownloadedVersion((v) => v ?? result.downloadedVersion);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCheck = async () => {
    setCheckState({ kind: 'checking' });
    try {
      const result = await ipc().updates.check();
      if (!result.success) {
        setCheckState({ kind: 'error', message: result.error });
        return;
      }
      if (result.updateAvailable) {
        setCheckState({
          kind: 'update-available',
          version: result.latestVersion,
          releaseUrl: result.releaseUrl,
        });
      } else {
        setCheckState({ kind: 'up-to-date' });
      }
    } catch (e) {
      setCheckState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Check failed',
      });
    }
  };

  // The button itself narrates checking -> confirmed/failed, so a terminal,
  // non-actionable result (up-to-date/error) reverts to the plain "Check for
  // Updates" state after a few seconds rather than announcing a stale check
  // forever. update-available is left alone — it's still actionable via
  // "View release" and should persist until the user updates.
  React.useEffect(() => {
    if (checkState.kind !== 'up-to-date' && checkState.kind !== 'error') return;
    const timer = setTimeout(() => setCheckState({ kind: 'idle' }), 4000);
    return () => clearTimeout(timer);
  }, [checkState]);

  // Leads with the installed version (always known); the check outcome lives
  // on the button itself (Checking for Updates -> You're on the latest
  // version / Check failed), so the description only needs to add the
  // persistent, actionable update-available case.
  const versionLabel = `Version ${version.data?.version ?? '—'}`;
  const checkDescription =
    checkState.kind === 'update-available'
      ? `${versionLabel} — Update available (v${checkState.version})`
      : versionLabel;

  return (
    <section data-settings-tab="about">
      <SettingRow label="Steno" description={checkDescription}>
        <div className="flex items-center gap-2">
          {checkState.kind === 'update-available' && (
            <Button
              variant="ghost"
              size="sm"
              className={COMPACT_BTN}
              onClick={() => void ipc().updates.openReleasePage(checkState.releaseUrl)}
            >
              View release
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className={COMPACT_BTN}
            onClick={() => void onCheck()}
            disabled={checkState.kind === 'checking'}
            title={checkState.kind === 'error' ? checkState.message : undefined}
          >
            {checkState.kind === 'checking' ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Checking for Updates
              </>
            ) : checkState.kind === 'up-to-date' ? (
              <>
                <Check className="mr-1.5 size-3" />
                You're on the latest version
              </>
            ) : checkState.kind === 'error' ? (
              <>
                <X className="mr-1.5 size-3" />
                Check failed
              </>
            ) : (
              'Check for Updates'
            )}
          </Button>
        </div>
      </SettingRow>

      {downloadPercent !== null && (
        <div className="py-3">
          <div
            className="mb-1.5 flex items-center justify-between text-[12px]"
            style={{ color: 'var(--fg-2)' }}
          >
            <span>Downloading update…</span>
            <span className="tabular-nums">{downloadPercent}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--surface-sunken)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${downloadPercent}%`, background: 'var(--fg-1)' }}
            />
          </div>
        </div>
      )}

      {downloadedVersion && (
        <div className="py-3">
          <Button
            className="w-full"
            onClick={() => ipc().updates.install()}
          >
            Restart to Update (v{downloadedVersion})
          </Button>
        </div>
      )}

      <SettingRow label="Release notes" description="See what's new">
        <ExternalLinkAction
          label="View"
          onClick={() => void ipc().shell.openExternal(CHANGELOG_URL)}
        />
      </SettingRow>

      <SettingRow label="Discord" description="Join the community, ask questions, share feedback">
        <ExternalLinkAction
          label="Join"
          onClick={() => void ipc().shell.openExternal(DISCORD_URL)}
        />
      </SettingRow>

      <SettingRow label="GitHub" description="Steno is open source — browse the code, file issues" noBorder>
        <ExternalLinkAction
          label="View"
          onClick={() => void ipc().shell.openExternal(GITHUB_URL)}
        />
      </SettingRow>

      {/* Legal footer — small, out of the settings-row rhythm above since
          these aren't actions on Steno itself. */}
      <div className="mt-8 flex items-center gap-3 text-[12px]" style={{ color: 'var(--fg-muted)' }}>
        <button
          type="button"
          onClick={() => void ipc().shell.openExternal(TERMS_URL)}
          className="hover:underline"
        >
          Terms of Service
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => void ipc().shell.openExternal(PRIVACY_URL)}
          className="hover:underline"
        >
          Privacy Policy
        </button>
      </div>
    </section>
  );
}
