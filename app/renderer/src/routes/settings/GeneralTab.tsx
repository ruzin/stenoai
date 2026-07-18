import * as React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isMac } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import {
  useAutoDetectMeetingsSetting,
  useDockIconSetting,
  useLaunchOnLoginSetting,
  useMicrophoneSetting,
  useNotificationsSetting,
  useOpenScreenRecordingSettings,
  useRelaunchApp,
  useRequestScreenRecordingPermission,
  useSetAutoDetectMeetings,
  useSetDockIcon,
  useSetLaunchOnLogin,
  useSetMicrophone,
  useSetNotifications,
  useSetSilenceAutoStopEnabled,
  useSetSilenceAutoStopMinutes,
  useSetSystemAudio,
  useSetUserName,
  useSilenceAutoStopSetting,
  useSystemAudioSetting,
  useSystemAudioSupport,
  useUserName,
} from '@/hooks/useSettings';
import { useAudioInputDevices } from '@/hooks/useAudioInputDevices';
import {
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import { COMPACT_BTN, COMPACT_TRIGGER, SettingRow } from './primitives';

const DEFAULT_MIC_VALUE = 'default';

export function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const notifications = useNotificationsSetting();
  const setNotifications = useSetNotifications();
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const systemAudioSupport = useSystemAudioSupport();
  const requestScreenRecording = useRequestScreenRecordingPermission();
  const openScreenRecordingSettings = useOpenScreenRecordingSettings();
  const relaunchApp = useRelaunchApp();
  // Screen Recording permission changes don't apply to an already-running
  // process — `screenPermissionAtLaunch` is frozen main-side at startup, so
  // comparing it to the live `screenPermission` tells apart "granted before
  // launch" from "granted mid-session, needs a relaunch to take effect."
  // (Deliberately not component state: that broke on tab remount, since a
  // freshly-mounted component would re-seed its "initial" value from the
  // now-live 'granted' status and silently lose the relaunch prompt.)
  const needsRelaunchForScreenRecording =
    systemAudioSupport.data?.screenPermissionAtLaunch !== 'granted' &&
    systemAudioSupport.data?.screenPermission === 'granted';
  const screenPermission = systemAudioSupport.data?.screenPermission;
  const systemAudioDescription = (() => {
    if (systemAudioSupport.data && !systemAudioSupport.data.supported) {
      return `Capture both sides of a call (requires macOS 14.4+, you're on ${systemAudioSupport.data.osVersion || 'an older version'}). Mic-only recording still works.`;
    }
    if (needsRelaunchForScreenRecording) {
      return 'Screen Recording access granted — relaunch Steno to start capturing both sides of a call.';
    }
    if (screenPermission === 'not-determined') {
      return 'Capture both sides of a call. Needs Screen Recording access first — mic-only recording still works either way.';
    }
    if (screenPermission === 'denied' || screenPermission === 'restricted') {
      return 'Capture both sides of a call. Screen Recording access was denied — enable it in System Settings, then relaunch Steno. Mic-only recording still works either way.';
    }
    return 'Capture both sides of a call. Turn off to record your mic only.';
  })();
  const autoDetect = useAutoDetectMeetingsSetting();
  const setAutoDetect = useSetAutoDetectMeetings();
  const launchOnLogin = useLaunchOnLoginSetting();
  const setLaunchOnLogin = useSetLaunchOnLogin();
  const silenceAutoStop = useSilenceAutoStopSetting();
  const setSilenceAutoStopEnabled = useSetSilenceAutoStopEnabled();
  const setSilenceAutoStopMinutes = useSetSilenceAutoStopMinutes();
  const dockIcon = useDockIconSetting();
  const setDockIcon = useSetDockIcon();
  const microphone = useMicrophoneSetting();
  const setMicrophone = useSetMicrophone();
  const audioInputDevices = useAudioInputDevices();
  const google = useGoogleCalendarAuth();
  const outlook = useOutlookCalendarAuth();
  const userName = useUserName();
  const setUserName = useSetUserName();
  const [nameDraft, setNameDraft] = React.useState('');
  const nameSeededRef = React.useRef(false);
  // Tracks in-flight typing so a late initial fetch can't clobber the user's
  // draft. Set on the first edit, and released again by persistName on blur —
  // the danger window is only mount → first commit, so once the edit is
  // committed the seeding effect is free to re-sync from userName.data.
  const nameDirtyRef = React.useRef(false);
  // Wait for the real query (not the sessionStorage placeholder) before
  // seeding — otherwise we lock onto a stale empty string and ignore the
  // canonical value when it arrives from disk.
  React.useEffect(() => {
    if (nameSeededRef.current) return;
    if (nameDirtyRef.current) return;
    if (userName.isPending || userName.isPlaceholderData) return;
    if (userName.data !== undefined) {
      setNameDraft(userName.data);
      nameSeededRef.current = true;
    }
  }, [userName.data, userName.isPending, userName.isPlaceholderData]);
  const persistName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed !== (userName.data ?? '')) {
      setUserName.mutate(trimmed);
    }
    // The editing session is over (committed on blur/Enter), so there's no more
    // in-flight typing to protect. Release the dirty guard so the seeding effect
    // can re-sync from any later userName.data change — the backend's canonical
    // value, or a refetch after the mutation invalidates. Otherwise a no-op
    // commit (draft equal to the not-yet-resolved placeholder) would leave the
    // guard stuck and the field stranded on a stale/blank draft.
    nameDirtyRef.current = false;
  };

  const calendarConnected =
    google.status.data?.connected || outlook.status.data?.connected;
  const calendarProvider = google.status.data?.connected
    ? 'Google'
    : outlook.status.data?.connected
      ? 'Outlook'
      : null;

  const [oauth, setOauth] = React.useState<
    | {
        provider: 'google' | 'outlook';
        state: 'pending' | 'error';
        message?: string;
      }
    | null
  >(null);

  React.useEffect(() => {
    if (!oauth) return;
    if (oauth.provider === 'google' && google.status.data?.connected) {
      setOauth(null);
    }
    if (oauth.provider === 'outlook' && outlook.status.data?.connected) {
      setOauth(null);
    }
  }, [oauth, google.status.data?.connected, outlook.status.data?.connected]);

  // Synchronous in-flight lock. react-query's isPending only flips true on the
  // NEXT render, so two clicks handled in the same tick both read a stale
  // false and slip past an isPending-based guard; a ref set before the first
  // mutate closes that exact window. The token distinguishes attempts so a
  // superseded attempt's settle (a cancel or a newer startConnect took over)
  // can't release a still-active attempt's lock.
  const connectingRef = React.useRef(false);
  const connectTokenRef = React.useRef(0);

  const startConnect = async (provider: 'google' | 'outlook') => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    const token = ++connectTokenRef.current;
    setOauth({ provider, state: 'pending' });
    try {
      if (provider === 'google') await google.connect.mutateAsync();
      else await outlook.connect.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A user-initiated Cancel rejects the connect mutation with "Cancelled"
      // (see useGoogleCalendarAuth/useOutlookCalendarAuth) — not an error to
      // surface back to the user.
      if (message === 'Cancelled') return;
      // Only surface the error if THIS attempt is still the active one. The
      // token check catches a cancel-then-immediate-retry of the same provider,
      // where a newer attempt is also `pending`/same-provider — provider+state
      // alone can't tell the stale rejection apart from the fresh dialog. It
      // also covers a dismissed dialog or a switch to a different provider.
      setOauth((current) =>
        connectTokenRef.current === token &&
        current?.provider === provider &&
        current.state === 'pending'
          ? { provider, state: 'error', message }
          : current,
      );
    } finally {
      // Release only if this is still the active attempt — a cancel or a newer
      // startConnect may have superseded it and now owns the lock.
      if (connectTokenRef.current === token) connectingRef.current = false;
    }
  };

  const cancelConnect = () => {
    // Abort the in-flight handshake so we don't leak a loopback OAuth server
    // that could silently complete the connection (and save tokens) after the
    // user has already backed out of the dialog.
    if (oauth?.state === 'pending') {
      if (oauth.provider === 'google') google.cancel.mutate();
      else outlook.cancel.mutate();
    }
    // Release the lock immediately so the user can retry or switch providers
    // without waiting for the abandoned mutation to reject.
    connectingRef.current = false;
    setOauth(null);
  };

  return (
    <section data-settings-tab="general">
      <SettingRow
        label="Your name"
        description="First name only — used for in-app greetings. Stored locally."
      >
        <Input
          value={nameDraft}
          onChange={(e) => {
            nameDirtyRef.current = true;
            setNameDraft(e.target.value);
          }}
          onBlur={persistName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Just blur — onBlur runs persistName, so calling it directly
              // here would queue a duplicate setUserName mutation.
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Ruzin"
          autoComplete="given-name"
          className="h-[30px] w-[180px] rounded-[6px] text-[13px]"
          data-testid="user-name-input"
        />
      </SettingRow>

      <SettingRow
        label="Appearance"
        description="Choose light, dark, or match your system"
      >
        <Select
          value={theme}
          onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
        >
          <SelectTrigger
            className={COMPACT_TRIGGER}
            data-testid="theme-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="Calendar"
        description={
          calendarConnected
            ? `Connected to ${calendarProvider}`
            : 'Show upcoming meetings on the home screen'
        }
      >
        {calendarConnected ? (
          <Button
            variant="outline"
            size="sm"
            className={COMPACT_BTN}
            onClick={() => {
              if (google.status.data?.connected) google.disconnect.mutate();
              else outlook.disconnect.mutate();
            }}
          >
            Disconnect
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className={COMPACT_BTN}
              onClick={() => void startConnect('google')}
            >
              Google
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={COMPACT_BTN}
              onClick={() => void startConnect('outlook')}
            >
              Outlook
            </Button>
          </div>
        )}
      </SettingRow>

      <OAuthPrompt
        state={oauth}
        onClose={cancelConnect}
        onRetry={() => oauth && void startConnect(oauth.provider)}
      />

      <SettingRow
        label="Desktop notifications"
        description="App Notifications"
      >
        <Switch
          checked={notifications.data ?? false}
          onCheckedChange={(v) => setNotifications.mutate(v)}
          disabled={notifications.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Microphone"
        description="Which input device Steno records from. Pins your choice so the OS switching its default (e.g. AirPods connecting) doesn't silently change what gets recorded. Applies the next time you start a recording."
      >
        <Select
          value={microphone.data?.device_id ?? DEFAULT_MIC_VALUE}
          onValueChange={(deviceId) => {
            if (deviceId === DEFAULT_MIC_VALUE) {
              setMicrophone.mutate({ deviceId: DEFAULT_MIC_VALUE, label: '' });
              return;
            }
            const device = audioInputDevices.find((d) => d.deviceId === deviceId);
            // Re-selecting the already-pinned-but-disconnected device (the
            // synthetic SelectItem below) won't be found in audioInputDevices
            // — fall back to its already-known stored label instead of
            // overwriting it with an empty string.
            const label =
              device?.label ??
              (deviceId === microphone.data?.device_id ? microphone.data?.label ?? '' : '');
            setMicrophone.mutate({ deviceId, label });
          }}
          disabled={microphone.data === undefined}
        >
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="microphone-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MIC_VALUE}>System Default</SelectItem>
            {audioInputDevices.map((d, i) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </SelectItem>
            ))}
            {/* The selected device was unplugged / isn't in the current device
                list — keep it selectable so the dropdown doesn't silently jump
                back to "System Default" out from under the user. */}
            {microphone.data?.device_id &&
              !audioInputDevices.some((d) => d.deviceId === microphone.data?.device_id) && (
                <SelectItem value={microphone.data.device_id}>
                  {microphone.data.label || 'Unknown device (disconnected)'}
                </SelectItem>
              )}
          </SelectContent>
        </Select>
      </SettingRow>

      {/* macOS only: chooses mic-only vs mic+system. Windows always records
          mic+system (toggle hidden), so this control isn't shown there. */}
      {isMac && (
        <SettingRow label="Record system audio" description={systemAudioDescription}>
          <div className="flex items-center gap-2">
            {/* Only offer permission actions when the OS actually supports the
                feature — on an unsupported macOS version, screenPermission can
                still read 'not-determined'/'denied' (that API predates the
                14.4 loopback requirement), but granting it wouldn't do
                anything: the toggle below is already disabled for OS reasons,
                so the description explaining "requires macOS 14.4+" should be
                the only thing shown, not an actionable-looking button. */}
            {systemAudioSupport.data?.supported === false ? null : needsRelaunchForScreenRecording ? (
              <Button
                variant="outline"
                size="sm"
                className={COMPACT_BTN}
                onClick={() => relaunchApp.mutate()}
              >
                Relaunch
              </Button>
            ) : screenPermission === 'not-determined' ? (
              <Button
                variant="outline"
                size="sm"
                className={COMPACT_BTN}
                onClick={() => requestScreenRecording.mutate()}
                disabled={requestScreenRecording.isPending}
              >
                Grant Access
              </Button>
            ) : screenPermission === 'denied' || screenPermission === 'restricted' ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className={COMPACT_BTN}
                  onClick={() => void systemAudioSupport.refetch()}
                >
                  Check Again
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={COMPACT_BTN}
                  onClick={() => openScreenRecordingSettings.mutate()}
                >
                  Open Settings
                </Button>
              </>
            ) : null}
            <Switch
              checked={(systemAudio.data ?? true) && (systemAudioSupport.data?.supported ?? true)}
              onCheckedChange={(v) => setSystemAudio.mutate(v)}
              disabled={systemAudio.data === undefined || systemAudioSupport.data?.supported === false}
            />
          </div>
        </SettingRow>
      )}

      <SettingRow
        label="Auto-detect meetings"
        description="Show a notification when another app starts using the microphone, with a one-click button to start recording."
      >
        <Switch
          checked={autoDetect.data ?? true}
          onCheckedChange={(v) => setAutoDetect.mutate(v)}
          disabled={autoDetect.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Launch on login"
        description="Start Steno automatically when you log in, hidden in the menu bar. Turn off to launch it manually."
      >
        <Switch
          checked={launchOnLogin.data ?? true}
          onCheckedChange={(v) => setLaunchOnLogin.mutate(v)}
          disabled={launchOnLogin.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Auto-stop on silence"
        description="End the recording and start processing it once both the mic and system audio have been silent for the chosen duration. Useful when you forget to stop after a meeting ends."
      >
        <div className="flex items-center gap-3">
          <Select
            value={String(silenceAutoStop.data?.minutes ?? 2)}
            onValueChange={(v) => setSilenceAutoStopMinutes.mutate(Number(v))}
            disabled={
              silenceAutoStop.data === undefined || silenceAutoStop.data.enabled === false
            }
          >
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(silenceAutoStop.data?.supportedMinutes ?? [2, 5, 10, 15, 30]).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            checked={silenceAutoStop.data?.enabled ?? true}
            onCheckedChange={(v) => setSilenceAutoStopEnabled.mutate(v)}
            disabled={silenceAutoStop.data === undefined}
          />
        </div>
      </SettingRow>

      {/* Dock + menu bar are macOS-only concepts and the apply logic in
          main.js is darwin-gated, so the toggle is a no-op off-mac. Hide it
          entirely on Windows/Linux rather than show a broken control. */}
      {isMac && (
        <SettingRow
          label="Hide dock icon"
          description="Run as menu bar app only"
          noBorder
        >
          <Switch
            checked={dockIcon.data ?? false}
            onCheckedChange={(v) => setDockIcon.mutate(v)}
            disabled={dockIcon.data === undefined}
          />
        </SettingRow>
      )}
    </section>
  );
}

interface OAuthPromptProps {
  state:
    | {
        provider: 'google' | 'outlook';
        state: 'pending' | 'error';
        message?: string;
      }
    | null;
  onClose: () => void;
  onRetry: () => void;
}

function OAuthPrompt({ state, onClose, onRetry }: OAuthPromptProps) {
  const open = !!state;
  const providerName = state?.provider === 'outlook' ? 'Outlook' : 'Google';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-oauth-prompt>
        <DialogHeader>
          <DialogTitle>
            {state?.state === 'error'
              ? `Couldn't connect to ${providerName}`
              : `Connecting to ${providerName}`}
          </DialogTitle>
          <DialogDescription>
            {state?.state === 'error'
              ? state.message || 'The authorization flow did not complete.'
              : 'Complete the authorization in your browser. This dialog will close automatically once access is granted.'}
          </DialogDescription>
        </DialogHeader>

        {state?.state === 'pending' && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-paper-0 p-3 text-sm text-muted-foreground dark:bg-paper-1">
            <Loader2 className="size-4 animate-spin text-foreground" />
            <span className="flex-1">Waiting for authorization…</span>
            <ExternalLink className="size-3.5" />
          </div>
        )}

        <DialogFooter>
          {state?.state === 'error' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={onRetry}>Try again</Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
