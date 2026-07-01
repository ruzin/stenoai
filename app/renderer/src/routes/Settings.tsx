import * as React from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
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
import { MeetingsShell } from '@/components/MeetingsShell';
import { useNavigate, getLastNonSettingsRoute, useRoute, getRouteParam } from '@/lib/router';
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
} from '@/lib/debugLogs';
import { cn, isMac } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import {
  useAppVersion,
  useClearSystemState,
  useDockIconSetting,
  useLanguageSetting,
  useNotificationsSetting,
  usePickStorageFolder,
  useSetDockIcon,
  useSetLanguage,
  useSetNotifications,
  useSetStoragePath,
  useSetSystemAudio,
  useSetTelemetry,
  useSetUserName,
  useStoragePath,
  useSystemAudioSetting,
  useSystemAudioSupport,
  useAutoDetectMeetingsSetting,
  useSetAutoDetectMeetings,
  useKeepRecordingsSetting,
  useSetKeepRecordings,
  useSilenceAutoStopSetting,
  useSetSilenceAutoStopEnabled,
  useSetSilenceAutoStopMinutes,
  useTelemetrySetting,
  useUserName,
} from '@/hooks/useSettings';
import {
  useAiProvider,
  useSetAiProvider,
  useSetBedrockInferenceProfile,
  useSetBedrockRegion,
  useSetCloudApiKey,
  useSetCloudApiUrl,
  useSetCloudModel,
  useSetCloudProvider,
  useSetRemoteOllamaUrl,
  useTestCloudApi,
  useTestRemoteOllama,
} from '@/hooks/useAi';
import {
  useCurrentModel,
  useDeleteModel,
  useModels,
  useParakeetModels,
  usePullModel,
  usePullParakeetModel,
  usePullWhisperModel,
  useSetActiveTranscription,
  useSetCurrentModel,
  useSwitchToFasterBuild,
  useTranscriptionEngine,
  useWhisperModels,
} from '@/hooks/useModels';
import {
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import {
  useTemplates,
  useSaveTemplate,
  useDeleteTemplate,
  useSetDefaultTemplate,
  useResetTemplate,
} from '@/hooks/useTemplates';
import type { AiProvider, CloudProvider, OrgStatusResponse, Template } from '@/lib/ipc';
import {
  useOrgAutoBackup,
  useOrgLogin,
  useOrgLogout,
  useOrgSession,
  useOrgSsoGoogle,
  useSetOrgAutoBackup,
} from '@/hooks/useOrg';

// ---------------------------------------------------------------------------
// Local style helpers — values come straight from the new design (Pencil
// bundle at /tmp/design-extract/.../Settings.jsx). Kept inline rather than
// promoted to /components/ui because they only fit the Settings layout.
// ---------------------------------------------------------------------------

const COMPACT_TRIGGER =
  'h-[30px] min-w-[150px] rounded-[6px] bg-[color:var(--surface-raised)] px-2.5 py-0 text-[13px]';
const COMPACT_BTN = 'h-[30px] px-3 text-[13px]';

type LangOption = { value: string; label: string };

// Curated language list shown in Settings → Transcribe. Whisper supports
// all 12 (it covers 99 languages at the model level; the dropdown is just
// the tested curation). Parakeet TDT v3 supports 25 European languages
// and is language-agnostic at inference — per-language hints don't bias
// the decoder, so we expose only Auto vs English-only. Picking a
// non-European concrete code (e.g. Hindi) on Parakeet would produce
// garbage; hiding the option avoids that footgun.
const LANGUAGES_WHISPER: LangOption[] = [
  { value: 'auto', label: 'Auto (detect)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
];
const LANGUAGES_PARAKEET: LangOption[] = [
  { value: 'auto', label: 'Auto (detect)' },
  { value: 'en', label: 'English' },
];

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'transcription', label: 'Transcribe' },
  { id: 'ai', label: 'AI' },
  { id: 'templates', label: 'Templates' },
  { id: 'organisation', label: 'Organisation' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'developer', label: 'Developer' },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ---------------------------------------------------------------------------
// File-private primitives
// ---------------------------------------------------------------------------

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  align?: 'center' | 'start';
  noBorder?: boolean;
  muted?: boolean;
}

function SettingRow({
  label,
  description,
  children,
  align = 'center',
  noBorder = false,
  muted = false,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex gap-6 py-4',
        align === 'start' ? 'items-start' : 'items-center',
      )}
      style={{
        borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
        opacity: muted ? 0.45 : 1,
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="text-[14px] font-medium"
          style={{ color: 'var(--fg-1)', marginBottom: 2 }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-[13px] leading-[1.5]"
            style={{ color: 'var(--fg-2)' }}
          >
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A read-only value with a click-to-copy button. Used for paths and IDs that
 *  users frequently need to paste into bug reports or terminal sessions. */
function CopyableValue({ value, mono = false }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write may fail on systems without permission. Fail silently
      // — the value is still visible and the user can select-copy manually.
    }
  };
  return (
    <div
      className="inline-flex max-w-full items-center gap-1 rounded-[4px] pl-2 pr-1 py-[2px]"
      style={{ background: 'var(--surface-sunken)', color: 'var(--fg-2)' }}
    >
      <code
        className={cn(
          'flex-1 truncate select-all text-[12px]',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        title={copied ? 'Copied' : 'Copy to clipboard'}
        className="inline-flex size-[22px] flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: copied ? 'var(--fg-1)' : 'var(--fg-2)' }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] font-medium uppercase"
      style={{
        letterSpacing: '0.06em',
        color: 'var(--fg-muted)',
        padding: '20px 0 8px',
      }}
    >
      {children}
    </div>
  );
}

/** Google's official multicolour 'G' glyph. Inlined so we don't carry a
 *  Google-branded asset file; the SVG paths are public branding material.
 *  Sized to sit cleanly next to a button label at our default font size. */
function GoogleGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'cursor-pointer border-0 bg-transparent px-3 py-1.5 text-[13px] transition-colors',
        active ? 'font-medium' : 'font-normal hover:text-[color:var(--fg-1)]',
      )}
      style={{
        color: active ? 'var(--fg-1)' : 'var(--fg-2)',
        borderTopLeftRadius: 'var(--radius-sm)',
        borderTopRightRadius: 'var(--radius-sm)',
        borderBottom: active
          ? '2px solid var(--fg-1)'
          : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

// Shared formatters used by both ModelList (Ollama) and WhisperModelList.
// Without these the two lists drift on cosmetic details (size units,
// default-label heuristic) and any future UX tweak has to be hand-applied
// to each component. The actual list components stay separate because
// ModelList has surface area Whisper doesn't need (deprecated section,
// remote/local provider split).
function formatModelSize(size_gb: number | undefined): string | undefined {
  if (size_gb === undefined) return undefined;
  if (size_gb < 1) return `${Math.round(size_gb * 1024)} MB`;
  return `${size_gb.toFixed(1)} GB`;
}

function isDefaultModel(description: string | undefined): boolean {
  return /\((default|recommended)\)/i.test(description ?? '');
}

function parsePullPercent(progress: string | undefined): number | null {
  const match = progress?.match(/(\d{1,3})%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function formatBytesPerSecond(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  const mbPerSecond = bytesPerSecond / (1024 * 1024);
  if (mbPerSecond < 1) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  return `${mbPerSecond.toFixed(1)} MB/s`;
}

interface ModelCardProps {
  name: string;
  sizeLabel?: string;
  note?: React.ReactNode;
  isCurrent: boolean;
  isDefault?: boolean;
  deprecated?: boolean;
  isDownloading?: boolean;
  downloadProgress?: string;
  onSelect: () => void;
  fasterBuildTag?: string;
  fasterBuildInstalled?: boolean;
  fasterBuildState?: 'idle' | 'pulling' | 'verifying' | 'done' | 'error';
  fasterBuildProgress?: string;
  fasterBuildBytesPerSecond?: number;
  // True when a DIFFERENT model's switch-to-faster-build is in flight. The
  // hook backing this only tracks one in-progress switch at a time, so
  // starting a second one while the first is still pulling/verifying/awaiting
  // its delete-confirmation silently drops the first one's completion event
  // (see useSwitchToFasterBuild's activeTagRef check) -- blocking here rather
  // than fixing that hook to track many at once, since real concurrent
  // switches were never a requested use case.
  fasterBuildBlocked?: boolean;
  onSwitchToFasterBuild?: () => void;
}

function ModelCard({
  name,
  sizeLabel,
  note,
  isCurrent,
  isDefault = false,
  deprecated = false,
  isDownloading = false,
  downloadProgress,
  onSelect,
  fasterBuildTag,
  fasterBuildInstalled = false,
  fasterBuildState = 'idle',
  fasterBuildProgress,
  fasterBuildBytesPerSecond,
  fasterBuildBlocked = false,
  onSwitchToFasterBuild,
}: ModelCardProps) {
  return (
    <div
      className="mb-1.5 flex items-center gap-4 rounded-[8px] px-4 py-[13px] transition-colors"
      style={{
        border: `1px solid ${
          isCurrent ? 'var(--border-strong)' : 'var(--border-subtle)'
        }`,
        background: isCurrent ? 'var(--surface-raised)' : 'transparent',
        // Dim deprecated rows EXCEPT when they're the user's current
        // selection. A user's active choice should never look disabled —
        // the Deprecated badge does the warning work, the dim just adds
        // noise for someone who already opted in (e.g. existing Whisper
        // Small users migrated from v0.3.7).
        opacity: deprecated && !isCurrent ? 0.4 : 1,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-[3px] flex flex-wrap items-baseline gap-2.5">
          <span
            className="font-mono text-[13px]"
            style={{
              color: 'var(--fg-1)',
              fontWeight: isCurrent ? 500 : 400,
            }}
          >
            {name}
          </span>
          {sizeLabel && (
            <span
              className="text-[12px] tabular-nums"
              style={{ color: 'var(--fg-muted)' }}
            >
              {sizeLabel}
            </span>
          )}
          {isDefault && !isCurrent && (
            <span
              className="rounded-[3px] px-1.5 py-px text-[11px]"
              style={{
                background: 'var(--surface-sunken)',
                color: 'var(--fg-muted)',
                border: '1px solid var(--border)',
              }}
            >
              Default
            </span>
          )}
          {deprecated && (
            <span
              className="rounded-[3px] px-1.5 py-px text-[11px]"
              style={{
                color: 'var(--fg-muted)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Deprecated
            </span>
          )}
        </div>
        {note && (
          <div
            className="text-[13px] leading-[1.4]"
            style={{ color: 'var(--fg-2)' }}
          >
            {note}
          </div>
        )}
        {isDownloading && downloadProgress && (
          <div
            className="mt-1 font-mono text-[12px]"
            style={{ color: 'var(--fg-2)' }}
          >
            {downloadProgress}
          </div>
        )}
      </div>
      {fasterBuildTag && !fasterBuildInstalled && (
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="rounded-[3px] px-1.5 py-px text-[11px]"
            style={{
              color: 'var(--fg-muted)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Faster build available
          </span>
          {fasterBuildState === 'pulling' ? (
            // Fixed-width bar instead of a variable-width percentage label:
            // Ollama's pull progress can update dozens of times per second on
            // a multi-GB download, and a text label whose width changes on
            // every tick reflows this whole row each time, which read as
            // window-level flicker. The bar's own footprint never changes —
            // only the fill width and a fixed-width, tabular-nums percentage
            // do — so rapid updates no longer shift any layout.
            <div className="flex items-center gap-1.5" style={{ width: 96 }}>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--surface-sunken)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${parsePullPercent(fasterBuildProgress) ?? 0}%`,
                    background: 'var(--fg-1)',
                  }}
                />
              </div>
              <span
                className="shrink-0 text-right text-[11px] tabular-nums"
                style={{ color: 'var(--fg-muted)', width: 28 }}
              >
                {parsePullPercent(fasterBuildProgress) ?? 0}%
              </span>
              {/* Fixed width + overflow-hidden for the same reason as the bar
                  above: "8.8 MB/s" and "120 KB/s" are different widths, so a
                  naive inline text here would reflow the row on every tick. */}
              <span
                className="shrink-0 overflow-hidden whitespace-nowrap text-[11px] tabular-nums"
                style={{ color: 'var(--fg-muted)', width: 60 }}
              >
                {formatBytesPerSecond(fasterBuildBytesPerSecond)}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSwitchToFasterBuild}
              disabled={fasterBuildState === 'verifying' || fasterBuildBlocked}
              title={fasterBuildBlocked ? 'Finish the current switch first' : undefined}
              className="cursor-pointer border-0 bg-transparent p-0 text-[12px] underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
              style={{ color: 'var(--fg-1)' }}
            >
              {fasterBuildState === 'verifying' && 'Verifying…'}
              {fasterBuildState === 'error' && 'Retry: switch to faster build'}
              {(fasterBuildState === 'idle' || fasterBuildState === 'done') && 'Switch to faster build'}
            </button>
          )}
        </div>
      )}
      {isCurrent ? (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium"
          style={{ color: 'var(--fg-1)' }}
        >
          <Check size={13} />
          Selected
        </span>
      ) : !deprecated ? (
        <Button
          variant="outline"
          size="sm"
          className="h-[28px] shrink-0 px-3.5 text-[13px]"
          disabled={isDownloading}
          onClick={onSelect}
        >
          {isDownloading ? (
            <>
              <Loader2 className="mr-1.5 size-3 animate-spin" />
              Downloading
            </>
          ) : (
            'Select'
          )}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export function Settings() {
  const navigate = useNavigate();
  // Deep-link support: /settings?tab=<id> opens the matching tab on mount.
  // Used by the sidebar's "Sign in to organisation" CTA to land users
  // directly on the org sign-in form rather than the General tab.
  const route = useRoute();
  const initialTab = React.useMemo<TabId>(() => {
    const requested = getRouteParam(route, 'tab');
    if (requested && TABS.some((t) => t.id === requested)) return requested as TabId;
    return 'general';
  }, []); // Intentional — only consume the URL param on first mount.
  const [tab, setTab] = React.useState<TabId>(initialTab);
  const version = useAppVersion();

  return (
    <MeetingsShell activeSummaryFile={null} bleed>
      <div
        data-testid="settings-page"
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--page)' }}
      >
        <header
          style={{
            padding: '32px 48px 0',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(getLastNonSettingsRoute() || '/')}
              aria-label="Back"
              className="flex size-7 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent transition-colors hover:text-[color:var(--fg-1)]"
              style={{ color: 'var(--fg-2)' }}
            >
              <ArrowLeft size={14} />
            </button>
            <h1
              className="m-0 text-[28px] font-normal"
              style={{
                fontFamily: 'var(--font-serif)',
                letterSpacing: '-0.02em',
                color: 'var(--fg-1)',
              }}
            >
              Settings
            </h1>
          </div>
          <div className="flex gap-0.5" role="tablist">
            {TABS.map((t) => (
              <TabButton
                key={t.id}
                active={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </TabButton>
            ))}
          </div>
        </header>

        <div
          className="scrollbar-clean min-h-0 flex-1 overflow-y-auto"
          style={{ padding: '8px 48px 64px' }}
        >
          <div style={{ maxWidth: 600, paddingTop: 8 }}>
            {tab === 'general' && <GeneralTab />}
            {tab === 'transcription' && <TranscriptionTab />}
            {tab === 'ai' && <AiTab />}
            {tab === 'templates' && <TemplatesTab />}
            {tab === 'organisation' && <OrganisationTab />}
            {tab === 'advanced' && <AdvancedTab />}
            {tab === 'developer' && <DeveloperTab />}
          </div>
          {tab === 'general' && (
            <div
              className="mt-10 text-center text-[12px]"
              style={{ color: 'var(--fg-muted)', maxWidth: 600 }}
            >
              Steno {version.data?.version ?? ''}
            </div>
          )}
        </div>
      </div>
    </MeetingsShell>
  );
}

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const notifications = useNotificationsSetting();
  const setNotifications = useSetNotifications();
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const systemAudioSupport = useSystemAudioSupport();
  const autoDetect = useAutoDetectMeetingsSetting();
  const setAutoDetect = useSetAutoDetectMeetings();
  const silenceAutoStop = useSilenceAutoStopSetting();
  const setSilenceAutoStopEnabled = useSetSilenceAutoStopEnabled();
  const setSilenceAutoStopMinutes = useSetSilenceAutoStopMinutes();
  const dockIcon = useDockIconSetting();
  const setDockIcon = useSetDockIcon();
  const google = useGoogleCalendarAuth();
  const outlook = useOutlookCalendarAuth();
  const userName = useUserName();
  const setUserName = useSetUserName();
  const [nameDraft, setNameDraft] = React.useState('');
  const nameSeededRef = React.useRef(false);
  // Wait for the real query (not the sessionStorage placeholder) before
  // seeding — otherwise we lock onto a stale empty string and ignore the
  // canonical value when it arrives from disk.
  React.useEffect(() => {
    if (nameSeededRef.current) return;
    if (userName.isPending || userName.isPlaceholderData) return;
    if (userName.data !== undefined) {
      setNameDraft(userName.data);
      nameSeededRef.current = true;
    }
  }, [userName.data, userName.isPending, userName.isPlaceholderData]);
  const persistName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed === (userName.data ?? '')) return;
    setUserName.mutate(trimmed);
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

  const startConnect = async (provider: 'google' | 'outlook') => {
    setOauth({ provider, state: 'pending' });
    try {
      if (provider === 'google') await google.connect.mutateAsync();
      else await outlook.connect.mutateAsync();
    } catch (err) {
      setOauth({
        provider,
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section data-settings-tab="general">
      <SettingRow
        label="Your name"
        description="First name only — used for in-app greetings. Stored locally."
      >
        <Input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
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
        onClose={() => setOauth(null)}
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

      {/* macOS only: chooses mic-only vs mic+system. Windows always records
          mic+system (toggle hidden), so this control isn't shown there. */}
      {isMac && (
        <SettingRow
          label="Record system audio"
          description={
            systemAudioSupport.data && !systemAudioSupport.data.supported
              ? `Capture both sides of a call (requires macOS 14.4+, you're on ${systemAudioSupport.data.osVersion || 'an older version'}). Mic-only recording still works.`
              : 'Capture both sides of a call. Turn off to record your mic only.'
          }
        >
          <Switch
            checked={(systemAudio.data ?? true) && (systemAudioSupport.data?.supported ?? true)}
            onCheckedChange={(v) => setSystemAudio.mutate(v)}
            disabled={systemAudio.data === undefined || systemAudioSupport.data?.supported === false}
          />
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
        label="Auto-stop on silence"
        description="End the recording and start processing it once both the mic and system audio have been silent for the chosen duration. Useful when you forget to stop after a meeting ends."
      >
        <div className="flex items-center gap-3">
          <Select
            value={String(silenceAutoStop.data?.minutes ?? 15)}
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

// ---------------------------------------------------------------------------
// Transcription tab
// ---------------------------------------------------------------------------

function TranscriptionTab() {
  const language = useLanguageSetting();
  const setLanguage = useSetLanguage();
  const keepRecordings = useKeepRecordingsSetting();
  const setKeepRecordings = useSetKeepRecordings();
  const engineQuery = useTranscriptionEngine();

  const engine = engineQuery.data ?? 'parakeet';
  const options = engine === 'whisper' ? LANGUAGES_WHISPER : LANGUAGES_PARAKEET;
  // useSetActiveTranscription coerces language to 'auto' when switching
  // to an engine that doesn't support the current pick. So by the time
  // this renders, persisted is normally in `options`. Edge case (CLI
  // user, migrated config): fall back to 'auto' for display so the
  // trigger isn't blank — the persisted value stays on disk until they
  // pick something new.
  const persisted = language.data ?? 'auto';
  const displayValue = options.some((o) => o.value === persisted) ? persisted : 'auto';
  const helperText =
    engine === 'parakeet'
      ? 'Auto-detect covers 25 European languages. For other languages, switch to Whisper.'
      : 'Language for transcription and summaries';

  return (
    <section data-settings-tab="transcription">
      <SettingRow
        label="Language"
        description={helperText}
      >
        <Select
          value={displayValue}
          onValueChange={(v) => setLanguage.mutate(v)}
          disabled={!language.data}
        >
          <SelectTrigger className={COMPACT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="Keep recordings"
        description="Save audio files after processing. Uses 1–10 MB per minute depending on capture mode."
      >
        <Switch
          checked={keepRecordings.data ?? false}
          onCheckedChange={(v) => setKeepRecordings.mutate(v)}
          disabled={keepRecordings.data === undefined}
        />
      </SettingRow>

      <SectionHeading>Models</SectionHeading>
      <TranscriptionModelList />
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI tab
// ---------------------------------------------------------------------------

function AiTab() {
  const provider = useAiProvider();
  const setProvider = useSetAiProvider();
  const orgSession = useOrgSession();
  const current = provider.data?.ai_provider ?? 'local';
  const orgSignedIn = orgSession.data?.signedIn ?? false;

  return (
    <section data-settings-tab="ai">
      <SettingRow
        label="AI provider"
        description={
          orgSignedIn
            ? "Managed by your organisation while you're signed in. Sign out under Settings > Organisation to change it."
            : 'Where models run. Local keeps all data on your device.'
        }
      >
        <Select
          value={current}
          onValueChange={(v) => setProvider.mutate(v as AiProvider)}
          disabled={!provider.data || orgSignedIn}
        >
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-72">
            <SelectItem
              value="local"
              description="Runs entirely on your device. Private and free, no internet required."
            >
              Local (on-device)
            </SelectItem>
            <SelectItem
              value="remote"
              description="Connect to your own Ollama server. Data stays within your network."
            >
              Private Server
            </SelectItem>
            <SelectItem
              value="cloud"
              description="Use OpenAI, Anthropic, or a compatible API. Best quality, requires a paid key."
            >
              Cloud API
            </SelectItem>
            <SelectItem
              value="adapter"
              disabled={!orgSignedIn}
              description={
                orgSignedIn
                  ? "Uses your organisation's AI key. No setup needed."
                  : 'Sign in to your organisation to enable this option.'
              }
            >
              Organisation
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {current === 'remote' && <RemoteProviderConfig />}
      {current === 'cloud' && <CloudProviderConfig />}
      {current === 'adapter' && <AdapterProviderInfo signedIn={orgSignedIn} />}

      {/* orgSignedIn check: while locked, the provider is (or is about to
          be reconciled to) 'adapter' — never show a local model list under
          the "Managed by your organisation" copy, even if the cached
          provider value is momentarily stale. */}
      {current !== 'cloud' && current !== 'adapter' && !orgSignedIn && (
        <>
          <SectionHeading>Model</SectionHeading>
          <ModelList />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Templates tab — manage summary report templates (CRUD + default pick).
// This is management UI only; it does not change how summaries are
// generated. The backend (Task 4) owns merging built-ins with user edits,
// so the renderer just lists what `templates.list()` returns and routes
// edits/resets/deletes back through the typed bridge.
// ---------------------------------------------------------------------------

// Template language picker. Built from LANGUAGES_WHISPER so the codes line
// up with Config.SUPPORTED_LANGUAGES (the 11 curated codes) plus 'auto',
// and we reuse its human labels rather than hardcoding a second list. A
// template's language pins the summary output language; 'auto' follows the
// transcript / global setting.
const TEMPLATE_LANGUAGES: LangOption[] = LANGUAGES_WHISPER;

function TemplatesTab() {
  const { templates, defaultId, isLoading } = useTemplates();
  const setDefault = useSetDefaultTemplate();
  const reset = useResetTemplate();
  const del = useDeleteTemplate();

  // null = editor closed; a Template = edit existing; {} = new template.
  const [editing, setEditing] = React.useState<Partial<Template> | null>(null);
  // Template pending deletion → drives the confirmation dialog.
  const [deleteTarget, setDeleteTarget] = React.useState<Template | null>(null);

  return (
    <section data-settings-tab="templates">
      <SettingRow
        label="Default template"
        description="The template used for new summaries unless you pick another."
      >
        <Select
          value={defaultId}
          onValueChange={(v) => setDefault.mutate(v)}
          disabled={isLoading || templates.length === 0}
        >
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-64">
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SectionHeading>Templates</SectionHeading>

      {templates.map((t) => (
        <div
          key={t.id}
          className="mb-1.5 flex items-center gap-4 rounded-[8px] px-4 py-[13px]"
          style={{
            border: '1px solid var(--border-subtle)',
            background:
              t.id === defaultId ? 'var(--surface-raised)' : 'transparent',
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: 'var(--fg-1)' }}
              >
                {t.name}
              </span>
              {t.locked && (
                <span
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--fg-muted)' }}
                  title="Built-in template — protected from editing and deletion"
                >
                  <Lock size={11} aria-hidden="true" />
                  Locked
                </span>
              )}
              {t.builtin && !t.locked && (
                <span
                  className="rounded-[3px] px-1.5 py-px text-[11px]"
                  style={{
                    color: 'var(--fg-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Built-in
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {t.builtin ? (
              // A locked built-in (Standard) can't be edited, so there is no
              // override to reset and nothing to edit — show no actions (the
              // "Locked" badge above already conveys its state). Only an
              // editable built-in offers Reset + Edit.
              !t.locked && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={COMPACT_BTN}
                    disabled={reset.isPending}
                    onClick={() => reset.mutate(t.id)}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={COMPACT_BTN}
                    onClick={() => setEditing(t)}
                  >
                    Edit
                  </Button>
                </>
              )
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={COMPACT_BTN}
                  onClick={() => setEditing(t)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    COMPACT_BTN,
                    'text-[color:var(--fg-2)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger)]',
                  )}
                  onClick={() => setDeleteTarget(t)}
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      {editing ? (
        <TemplateEditor
          key={editing.id ?? 'new'}
          editing={editing.id ? editing : null}
          onClose={() => setEditing(null)}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={cn(COMPACT_BTN, 'mt-3')}
          onClick={() => setEditing({})}
        >
          <Plus size={14} className="mr-1.5" />
          New Template
        </Button>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Delete template "${deleteTarget.name}"?` : ''}
        description="This permanently deletes the template. Reports already generated from it are not affected."
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await del.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}

/** Inline editor for creating or editing a template. Surfaces backend
 *  validation/save errors inline rather than throwing — the save handler
 *  is the verbatim spec from the task brief. */
function TemplateEditor({
  editing,
  onClose,
}: {
  editing: Partial<Template> | null;
  onClose: () => void;
}) {
  const save = useSaveTemplate();
  const [name, setName] = React.useState(editing?.name ?? '');
  const [prompt, setPrompt] = React.useState(editing?.prompt ?? '');
  const [language, setLanguage] = React.useState(editing?.language ?? 'auto');
  const [error, setError] = React.useState<string | null>(null);

  const onSave = () => {
    setError(null);
    save.mutate(
      { id: editing?.id, name, prompt, language },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof Error ? e.message : 'Save failed'),
      },
    );
  };

  return (
    <div
      className="mt-3 rounded-[8px] p-4"
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-raised)',
      }}
    >
      <div
        className="mb-3 text-[13px] font-medium"
        style={{ color: 'var(--fg-1)' }}
      >
        {editing ? 'Edit template' : 'New template'}
      </div>

      <SettingRow label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly sync"
          className="h-[30px] w-[220px] text-[13px]"
        />
      </SettingRow>

      <SettingRow label="Language" description="Output language for the summary.">
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="pt-3">
        <div
          className="mb-2 text-[13px] font-medium"
          style={{ color: 'var(--fg-1)' }}
        >
          Prompt
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Summarise the meeting as…"
          rows={10}
          className="w-full min-h-[200px] text-[13px] leading-relaxed"
        />
      </div>

      {error && (
        <div
          className="mt-2 text-[12px]"
          style={{ color: 'var(--accent-danger, var(--fg-1))' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={COMPACT_BTN}
          onClick={onClose}
          disabled={save.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className={COMPACT_BTN}
          onClick={onSave}
          disabled={save.isPending || !name.trim()}
        >
          {save.isPending ? (
            <>
              <Loader2 className="mr-1.5 size-3 animate-spin" />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </div>
  );
}

/** Adapter mode has no per-user configuration — the customer's IT
 *  controls the model + API key on the adapter side. This block just
 *  reassures the user it's working (or warns them if their session has
 *  lapsed, in which case summarisation would fall back to an error). */
function AdapterProviderInfo({ signedIn }: { signedIn: boolean }) {
  return (
    <div
      className="space-y-2 py-4 text-[12px]"
      style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--fg-2)' }}
    >
      {signedIn ? (
        <p>
          Summaries, titles, and chat are routed through your organisation's
          adapter. The model and API key are configured by your organisation
          — no setup needed here.
        </p>
      ) : (
        <p style={{ color: 'var(--accent-danger, var(--fg-1))' }}>
          You are not signed in to an organisation. Sign in under{' '}
          <strong>Settings &gt; Organisation</strong>, or switch this provider
          back to Local / Private Server / Cloud API.
        </p>
      )}
    </div>
  );
}

function RemoteProviderConfig() {
  const provider = useAiProvider();
  const setUrl = useSetRemoteOllamaUrl();
  const testConnection = useTestRemoteOllama();
  const [url, setLocalUrl] = React.useState('');

  React.useEffect(() => {
    if (provider.data?.remote_ollama_url) {
      setLocalUrl(provider.data.remote_ollama_url);
    }
  }, [provider.data?.remote_ollama_url]);

  return (
    <div
      className="space-y-3 py-4"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          Ollama server URL
        </label>
        <Input
          value={url}
          onChange={(e) => setLocalUrl(e.target.value)}
          placeholder="http://192.168.1.100:11434"
          onBlur={() => url && setUrl.mutate(url)}
          className="h-[30px] text-[13px]"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className={COMPACT_BTN}
          onClick={() => testConnection.mutate(url)}
          disabled={!url || testConnection.isPending}
        >
          {testConnection.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <ConnectionStatus
          ok={testConnection.isSuccess ? testConnection.data?.ok ?? true : testConnection.isError ? false : undefined}
          message={
            testConnection.isError
              ? testConnection.error instanceof Error
                ? testConnection.error.message
                : 'Failed'
              : testConnection.data?.message
          }
        />
      </div>
    </div>
  );
}

function CloudProviderConfig() {
  const provider = useAiProvider();
  const setCloudProvider = useSetCloudProvider();
  const setCloudUrl = useSetCloudApiUrl();
  const setCloudKey = useSetCloudApiKey();
  const setCloudModel = useSetCloudModel();
  const setBedrockRegion = useSetBedrockRegion();
  const setBedrockProfile = useSetBedrockInferenceProfile();
  const testConnection = useTestCloudApi();

  const cloudProvider = provider.data?.cloud_provider ?? 'openai';
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('gpt-4o-mini');
  const [bedrockRegion, setBedrockRegionState] = React.useState('us-east-1');
  const [bedrockProfile, setBedrockProfileState] = React.useState('');
  // Bedrock has a curated dropdown of Claude model ids (from the backend) so
  // the user doesn't have to know the exact `anthropic.claude-…:0` strings.
  const bedrockModels = provider.data?.bedrock_supported_models ?? [];
  // When provider changes, the available-models cache is provider-specific
  // and the persisted model name swaps. Track which provider the model list
  // belongs to so we don't show OpenAI models against an Anthropic key.
  const [modelListFor, setModelListFor] = React.useState<CloudProvider | null>(null);
  const [customModelMode, setCustomModelMode] = React.useState(false);

  // Sync apiUrl/model from server-side state (separate effect: runs on any
  // provider.data change so the model name stays in sync after a successful
  // setCloudModel mutation).
  React.useEffect(() => {
    if (provider.data) {
      setApiUrl(provider.data.cloud_api_url);
      setModel(provider.data.cloud_model);
    }
  }, [provider.data?.cloud_api_url, provider.data?.cloud_model]);

  // Sync Bedrock fields from server-side state. Kept separate from the
  // cloud_api_url/model sync because the deps array would conflate setter
  // notifications across providers, causing the bedrock state to bounce
  // when an unrelated openai-mode change lands.
  React.useEffect(() => {
    if (provider.data) {
      setBedrockRegionState(provider.data.bedrock_region || 'us-east-1');
      setBedrockProfileState(provider.data.bedrock_inference_profile || '');
    }
  }, [provider.data?.bedrock_region, provider.data?.bedrock_inference_profile]);

  // Reset the cached model list ONLY when the provider changes — otherwise
  // selecting a model triggers a model-name change which would dump the
  // dropdown the user just picked from.
  React.useEffect(() => {
    if (provider.data) {
      setModelListFor((prev) =>
        prev === provider.data!.cloud_provider ? prev : null,
      );
      setCustomModelMode(false);
      testConnection.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.data?.cloud_provider]);

  const onTest = () => {
    setModelListFor(cloudProvider);
    testConnection.mutate();
  };

  // Bedrock surfaces a curated list of Claude model ids from the backend, so
  // the dropdown is populated immediately — no need to Test connection first.
  // Other providers still gate the dropdown on a successful list-models call.
  const availableModels =
    cloudProvider === 'bedrock'
      ? bedrockModels
      : modelListFor === cloudProvider && testConnection.isSuccess
        ? testConnection.data?.models ?? []
        : [];
  const showModelDropdown = availableModels.length > 0 && !customModelMode;
  // Persist the selected model immediately on change (Select doesn't fire
  // onBlur, so the previous "save on blur" pattern would lose the choice).
  const onModelSelect = (next: string) => {
    if (next === '__custom__') {
      setCustomModelMode(true);
      return;
    }
    setModel(next);
    setCloudModel.mutate(next);
  };

  return (
    <div
      className="space-y-3 py-4"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          Service
        </label>
        <Select
          value={cloudProvider}
          onValueChange={(v) => setCloudProvider.mutate(v as CloudProvider)}
        >
          <SelectTrigger className="h-[30px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
            <SelectItem value="bedrock">AWS Bedrock (Claude)</SelectItem>
            <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {cloudProvider === 'bedrock' && (
        <>
          <div>
            <label
              className="mb-1 block text-[12px] font-medium uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
            >
              AWS region
            </label>
            <Input
              value={bedrockRegion}
              onChange={(e) => setBedrockRegionState(e.target.value)}
              placeholder="us-east-1"
              onBlur={() =>
                bedrockRegion && setBedrockRegion.mutate(bedrockRegion)
              }
              className="h-[30px] text-[13px]"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-[12px] font-medium uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
            >
              Inference profile (optional)
            </label>
            <Input
              value={bedrockProfile}
              onChange={(e) => setBedrockProfileState(e.target.value)}
              placeholder="us.anthropic.claude-…"
              onBlur={() => setBedrockProfile.mutate(bedrockProfile.trim())}
              className="h-[30px] text-[13px]"
            />
          </div>
        </>
      )}
      {cloudProvider === 'custom' && (
        <div>
          <label
            className="mb-1 block text-[12px] font-medium uppercase"
            style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
          >
            API base URL
          </label>
          <Input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            onBlur={() => apiUrl && setCloudUrl.mutate(apiUrl)}
            className="h-[30px] text-[13px]"
          />
        </div>
      )}
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          API key
        </label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            provider.data?.cloud_api_key_set
              ? '••••••••'
              : cloudProvider === 'bedrock'
                ? 'Bedrock API key (bearer token)'
                : cloudProvider === 'anthropic'
                  ? 'sk-ant-…'
                  : 'sk-…'
          }
          onBlur={() => apiKey && setCloudKey.mutate(apiKey)}
          className="h-[30px] text-[13px]"
        />
      </div>
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          Model
        </label>
        {showModelDropdown ? (
          <Select value={model} onValueChange={onModelSelect}>
            <SelectTrigger className="h-[30px] text-[13px]">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {/* If the persisted model isn't in the fetched list (e.g. a
                  user-typed custom name from before), still show it so the
                  Trigger doesn't render blank. */}
              {!availableModels.includes(model) && model && (
                <SelectItem value={model}>{model}</SelectItem>
              )}
              {availableModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom…</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                cloudProvider === 'bedrock'
                  ? 'anthropic.claude-…-v1:0'
                  : cloudProvider === 'anthropic'
                    ? 'claude-…'
                    : 'gpt-…'
              }
              onBlur={() => model && setCloudModel.mutate(model)}
              className="h-[30px] text-[13px]"
            />
            {availableModels.length > 0 && customModelMode && (
              <Button
                variant="ghost"
                size="sm"
                className={COMPACT_BTN}
                onClick={() => setCustomModelMode(false)}
              >
                Pick from list
              </Button>
            )}
          </div>
        )}
        {availableModels.length === 0 && cloudProvider !== 'bedrock' && (
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--fg-muted)' }}>
            Test connection to load the list of available models.
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className={COMPACT_BTN}
          onClick={onTest}
          disabled={testConnection.isPending}
        >
          {testConnection.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <ConnectionStatus
          ok={testConnection.isSuccess ? true : testConnection.isError ? false : undefined}
          message={
            testConnection.isError
              ? testConnection.error instanceof Error
                ? testConnection.error.message
                : 'Failed'
              : testConnection.isSuccess && testConnection.data?.models
                ? `${testConnection.data.models.length} models available`
                : undefined
          }
        />
      </div>
      <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
        Transcripts will be sent to a third-party cloud service. No audio files
        leave your device.
      </div>
    </div>
  );
}

function ConnectionStatus({
  ok,
  message,
}: {
  ok: boolean | undefined;
  message?: string;
}) {
  if (ok === undefined) return null;
  return (
    <span
      className="flex items-center gap-1.5 text-[12px]"
      style={{ color: ok ? 'var(--fg-1)' : 'var(--danger)' }}
    >
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      {message ?? (ok ? 'Connected' : 'Failed')}
    </span>
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


/**
 * Unified Parakeet + Whisper picker. One row per model, regardless of
 * engine — clicking [Select] on an installed row activates that engine
 * (and, for Whisper rows, also sets `whisper_model`). Clicking [Download]
 * pulls the model; on success the pull-completion handler in the
 * use(Parakeet|Whisper)Model hook flips the active engine over, so the
 * user lands on the row they just downloaded.
 *
 * Parakeet sits at the top because new installs default to it; the
 * migration in src/config.py keeps existing users on Whisper, but if
 * they're seeing this UI on an upgraded install the Whisper row will
 * already be marked Selected so the position-as-default reading is OK.
 */
function TranscriptionModelList() {
  const parakeet = useParakeetModels();
  const whisper = useWhisperModels();
  const engine = useTranscriptionEngine();
  const setActive = useSetActiveTranscription();
  const pullParakeet = usePullParakeetModel();
  const pullWhisper = usePullWhisperModel();

  const isLoading = parakeet.isLoading || whisper.isLoading || engine.isLoading;
  const isError = parakeet.isError || whisper.isError || engine.isError;

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-[13px]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Loader2 className="size-3.5 animate-spin" />
        Loading models…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
        Could not load transcription models.
      </div>
    );
  }

  const activeEngine = engine.data ?? 'parakeet';
  const activeWhisperModel = whisper.data?.current;

  type Row = {
    rowKey: string;
    engine: 'parakeet' | 'whisper';
    modelId: string;
    displayName: string;
    sizeLabel?: string;
    note?: string;
    installed: boolean;
    isCurrent: boolean;
    isDownloading: boolean;
    downloadProgress?: string;
    deprecated: boolean;
    onSelect: () => void;
  };

  const parakeetRows: Row[] = (parakeet.data?.models ?? []).map((m) => {
    const isDownloading = Boolean(pullParakeet.progress[m.name]);
    const stage = pullParakeet.progress[m.name];
    const downloadProgress = stage
      ? stage === 'downloading'
        ? 'Downloading…'
        : stage === 'loading'
          ? 'Loading model…'
          : stage
      : undefined;
    return {
      rowKey: `parakeet:${m.name}`,
      engine: 'parakeet',
      modelId: m.name,
      displayName: m.displayName ?? m.name,
      sizeLabel: formatModelSize(m.size_gb),
      note: m.description,
      installed: m.installed,
      isCurrent: activeEngine === 'parakeet' && m.installed,
      isDownloading,
      downloadProgress,
      deprecated: Boolean(m.deprecated),
      onSelect: () => {
        if (m.installed) {
          setActive.mutate({ engine: 'parakeet' });
        } else {
          pullParakeet.mutate(m.name);
        }
      },
    };
  });

  const whisperRows: Row[] = (whisper.data?.models ?? []).map((m) => ({
    rowKey: `whisper:${m.name}`,
    engine: 'whisper',
    modelId: m.name,
    displayName: m.displayName ?? m.name,
    sizeLabel: formatModelSize(m.size_gb),
    note: m.description,
    installed: m.installed,
    isCurrent:
      activeEngine === 'whisper' && m.installed && m.name === activeWhisperModel,
    isDownloading: Boolean(pullWhisper.progress[m.name]),
    downloadProgress: pullWhisper.progress[m.name],
    deprecated: Boolean(m.deprecated),
    onSelect: () => {
      if (m.installed) {
        setActive.mutate({ engine: 'whisper', whisperModel: m.name });
      } else {
        pullWhisper.mutate(m.name);
      }
    },
  }));

  const rows: Row[] = [...parakeetRows, ...whisperRows];

  return (
    <div>
      {rows.map((row) => (
        <ModelCard
          key={row.rowKey}
          name={row.displayName}
          sizeLabel={row.sizeLabel}
          note={row.note}
          isCurrent={row.isCurrent}
          deprecated={row.deprecated}
          isDownloading={row.isDownloading}
          downloadProgress={row.downloadProgress}
          onSelect={row.onSelect}
        />
      ))}
    </div>
  );
}

function ModelList() {
  const models = useModels();
  const current = useCurrentModel();
  const setCurrent = useSetCurrentModel();
  const pull = usePullModel();
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  const [deleteCandidate, setDeleteCandidate] = React.useState<{ tag: string; sizeLabel?: string } | null>(null);
  const deleteModel = useDeleteModel();
  const fasterBuild = useSwitchToFasterBuild((mlxTag) => {
    const match = models.data?.models.find((m) => m.mlxTag === mlxTag);
    if (match) {
      setDeleteCandidate({ tag: match.name, sizeLabel: formatModelSize(match.size_gb) });
    }
  });

  if (models.isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-[13px]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Loader2 className="size-3.5 animate-spin" />
        Loading models…
      </div>
    );
  }
  if (models.isError) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
        Could not reach Ollama. Run the setup wizard.
      </div>
    );
  }
  if (!models.data?.models?.length) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
        No models available.
      </div>
    );
  }

  const isRemote = models.data.provider === 'remote';
  const sorted = [...models.data.models].sort(
    (a, b) => (a.deprecated ? 1 : 0) - (b.deprecated ? 1 : 0),
  );
  const active = sorted.filter((m) => !m.deprecated);
  const deprecated = sorted.filter((m) => m.deprecated);

  const renderCard = (m: (typeof sorted)[number]) => {
    const isCurrent = m.name === current.data;
    const isDownloading = Boolean(pull.progress[m.name]);
    const downloadProgress = pull.progress[m.name];
    const isDefault = !isRemote && isDefaultModel(m.description);

    let note: string | undefined;
    if (isRemote && m.description) {
      note = m.description;
    } else if (!isRemote) {
      const parts: string[] = [];
      if (m.speed) parts.push(`${m.speed} speed`);
      if (m.quality) parts.push(`${m.quality} quality`);
      note = parts.length ? parts.join(' · ') : undefined;
    }

    const sizeLabel = formatModelSize(m.size_gb);
    const isFasterBuildActive = fasterBuild.activeTag === m.mlxTag;
    const fasterBuildBlocked =
      Boolean(fasterBuild.activeTag) &&
      !isFasterBuildActive &&
      (fasterBuild.state === 'pulling' || fasterBuild.state === 'verifying' || fasterBuild.state === 'done');

    const onSelect = () => {
      if (m.installed) {
        setCurrent.mutate(m.name);
      } else {
        pull.mutate(m.name);
      }
    };

    return (
      <ModelCard
        key={m.name}
        name={m.name}
        sizeLabel={sizeLabel}
        note={note}
        isCurrent={isCurrent}
        isDefault={isDefault}
        deprecated={Boolean(m.deprecated)}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onSelect={onSelect}
        fasterBuildTag={m.installed ? m.mlxTag : undefined}
        fasterBuildInstalled={Boolean(m.mlxInstalled)}
        fasterBuildState={isFasterBuildActive ? fasterBuild.state : 'idle'}
        fasterBuildProgress={isFasterBuildActive ? fasterBuild.progress : undefined}
        fasterBuildBytesPerSecond={isFasterBuildActive ? fasterBuild.bytesPerSecond : undefined}
        fasterBuildBlocked={fasterBuildBlocked}
        onSwitchToFasterBuild={() => {
          if (!m.mlxTag || fasterBuildBlocked) return;
          fasterBuild.switchTo(m.mlxTag);
        }}
      />
    );
  };

  return (
    <div>
      {active.map(renderCard)}

      {deprecated.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowDeprecated((d) => !d)}
            className="mt-4 flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[13px]"
            style={{ color: 'var(--fg-muted)' }}
          >
            {showDeprecated ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            {showDeprecated ? 'Hide' : 'Show'} deprecated models
          </button>

          {showDeprecated && (
            <div className="mt-2">{deprecated.map(renderCard)}</div>
          )}
        </>
      )}

      {deleteCandidate && (
        <ConfirmDialog
          open={Boolean(deleteCandidate)}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteCandidate(null);
              fasterBuild.reset();
            }
          }}
          title="Delete the old build?"
          description={`${deleteCandidate.tag} (${deleteCandidate.sizeLabel ?? 'unknown size'}) is no longer needed now that the faster build is active. Delete it to free up disk space?`}
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await deleteModel.mutateAsync(deleteCandidate.tag);
            setDeleteCandidate(null);
            fasterBuild.reset();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organisation tab — connect to a self-hosted Steno enterprise adapter.
// ---------------------------------------------------------------------------

const ORG_ADAPTER_URL_KEY = 'steno-org-adapter-url';
const ORG_ADAPTER_URL_DEFAULT = 'http://localhost:8000';

function OrganisationTab() {
  // useOrgSession + the login/logout mutations all share the same TanStack
  // Query key, so every other consumer (sidebar 'Shared notes' row, profile
  // chip, AskBar gating) reacts immediately to a sign-in or sign-out here.
  const sessionQuery = useOrgSession();
  const loginMutation = useOrgLogin();
  const ssoGoogleMutation = useOrgSsoGoogle();
  const logoutMutation = useOrgLogout();
  const autoBackupQuery = useOrgAutoBackup();
  const setAutoBackup = useSetOrgAutoBackup();
  const status: OrgStatusResponse | null = sessionQuery.data ?? null;

  // Remember the last adapter URL the user typed/signed-in-against so they
  // don't have to retype on every sign-out. Falls back to localhost for
  // first-time / dev usage. The session itself stores its own copy, so this
  // is only consulted when the user is *not* currently signed in.
  const initialAdapterUrl = React.useMemo(() => {
    try {
      return localStorage.getItem(ORG_ADAPTER_URL_KEY) || ORG_ADAPTER_URL_DEFAULT;
    } catch {
      return ORG_ADAPTER_URL_DEFAULT;
    }
  }, []);
  const [adapterUrl, setAdapterUrl] = React.useState(initialAdapterUrl);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Seed the form's adapter URL from the persisted session, once we know it.
  React.useEffect(() => {
    if (status?.adapterUrl) setAdapterUrl(status.adapterUrl);
  }, [status?.adapterUrl]);

  // Mirror the field into localStorage so the next sign-in lands with the
  // same URL pre-filled even if the user has signed out (which clears the
  // session record entirely).
  React.useEffect(() => {
    if (!adapterUrl) return;
    try { localStorage.setItem(ORG_ADAPTER_URL_KEY, adapterUrl); } catch (_) { /* private mode */ }
  }, [adapterUrl]);

  const busy =
    loginMutation.isPending ||
    logoutMutation.isPending ||
    ssoGoogleMutation.isPending;

  const onSignIn = async () => {
    setError(null);
    try {
      await loginMutation.mutateAsync({ adapterUrl, email, password });
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onGoogleSignIn = async () => {
    setError(null);
    try {
      await ssoGoogleMutation.mutateAsync(adapterUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSignOut = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section data-settings-tab="organisation">
      <SectionHeading>Organisation</SectionHeading>
      <p
        className="mb-5 text-[13px] leading-[1.55]"
        style={{ color: 'var(--fg-2)', maxWidth: '60ch' }}
      >
        Connect to Steno Enterprise for your organisation.
      </p>

      {status?.signedIn ? (
        <div
          className="mb-5 rounded-[10px] p-4"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
          }}
          data-testid="org-signed-in-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium" style={{ color: 'var(--fg-1)' }}>
                Signed in as {status.name}
              </div>
              <div className="mt-0.5 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                {status.email} · org <span style={{ fontFamily: 'var(--font-mono)' }}>{status.orgId}</span>
              </div>
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {status.adapterUrl}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              disabled={busy}
              className="h-[28px] px-3 text-[12px]"
            >
              Sign out
            </Button>
          </div>
          <div
            className="mt-4 flex items-start justify-between gap-4 border-t pt-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
                Auto-back up new notes
              </div>
              <div
                className="mt-0.5 text-[12px] leading-[1.5]"
                style={{ color: 'var(--fg-2)', maxWidth: '52ch' }}
              >
                Push every new note to your org's S3 once summarisation finishes. You can still
                unshare individual notes from the Shared notes view.
              </div>
            </div>
            <Switch
              checked={autoBackupQuery.data ?? true}
              onCheckedChange={(v) => setAutoBackup.mutate(v)}
              disabled={autoBackupQuery.data === undefined || setAutoBackup.isPending}
              aria-label="Auto-back up new notes to org"
            />
          </div>
        </div>
      ) : (
        <div
          className="mb-5 rounded-[10px] p-4"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
          }}
          data-testid="org-sign-in-card"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                Adapter URL
              </label>
              <Input
                value={adapterUrl}
                onChange={(e) => setAdapterUrl(e.target.value)}
                placeholder="https://steno-adapter.yourcompany.com"
                className="h-[30px] rounded-[6px] text-[13px]"
                disabled={busy}
              />
            </div>

            {/* SSO — primary path for customer deployments. The button opens
                the system browser, waits for the Google sign-in to redirect
                back to a loopback port, and exchanges the code through the
                adapter (client_secret never touches this Mac). */}
            <div className="flex items-center gap-3">
              <Button
                onClick={onGoogleSignIn}
                disabled={busy || !adapterUrl}
                variant="outline"
                className={cn(COMPACT_BTN, 'gap-2')}
              >
                <GoogleGlyph />
                {ssoGoogleMutation.isPending ? 'Waiting for browser…' : 'Sign in with Google'}
              </Button>
              <span className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
                Single sign-on via your organisation's Google Workspace.
              </span>
            </div>

            <div className="relative my-1 flex items-center gap-2">
              <span className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
              <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                or
              </span>
              <span className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                  Email
                </label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  autoComplete="email"
                  className="h-[30px] rounded-[6px] text-[13px]"
                  disabled={busy}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  className="h-[30px] rounded-[6px] text-[13px]"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onSignIn();
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={onSignIn}
                disabled={busy || !adapterUrl || !email || !password}
                variant="ghost"
                className={COMPACT_BTN}
              >
                {loginMutation.isPending ? 'Signing in…' : 'Sign in with password'}
              </Button>
              {error && (
                <span className="text-[12px]" style={{ color: 'var(--danger, #b3261e)' }}>
                  {error}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Advanced tab
// ---------------------------------------------------------------------------

function AdvancedTab() {
  const navigate = useNavigate();
  const storage = useStoragePath();
  const setStorage = useSetStoragePath();
  const pickFolder = usePickStorageFolder();
  const clearState = useClearSystemState();
  const telemetry = useTelemetrySetting();
  const setTelemetry = useSetTelemetry();

  const chooseFolder = async () => {
    try {
      const folder = await pickFolder.mutateAsync();
      if (folder) setStorage.mutate(folder);
    } catch {
      // cancelled
    }
  };

  const resetFolder = () => {
    if (storage.data?.default_path) {
      setStorage.mutate(storage.data.default_path);
    }
  };

  const custom =
    storage.data?.custom_path &&
    storage.data.custom_path !== storage.data.default_path;
  const path = storage.data?.storage_path ?? storage.data?.default_path;

  return (
    <section data-settings-tab="advanced">
      <div
        className="flex items-start justify-between gap-6 py-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[14px] font-medium"
            style={{ color: 'var(--fg-1)', marginBottom: 2 }}
          >
            Storage location
          </div>
          <div
            className="mb-2 text-[13px]"
            style={{ color: 'var(--fg-2)' }}
          >
            Where your notes and recordings are saved
          </div>
          {path && <CopyableValue value={path} mono />}
        </div>
        <div className="flex shrink-0 gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className={COMPACT_BTN}
            onClick={chooseFolder}
          >
            Choose…
          </Button>
          {custom && (
            <Button
              variant="ghost"
              size="sm"
              className={COMPACT_BTN}
              onClick={resetFolder}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      <SettingRow
        label="Setup wizard"
        description="Reinstall dependencies or fix configuration"
      >
        <Button
          variant="outline"
          size="sm"
          className={COMPACT_BTN}
          onClick={() => navigate('/setup')}
        >
          Run
        </Button>
      </SettingRow>

      <SettingRow
        label="Clear recording state"
        description="Fix stuck recordings or processing"
      >
        <Button
          variant="outline"
          size="sm"
          className={COMPACT_BTN}
          onClick={() => clearState.mutate()}
          disabled={clearState.isPending}
          style={{ color: 'var(--danger)' }}
        >
          {clearState.isPending ? 'Clearing…' : 'Clear'}
        </Button>
      </SettingRow>

      <SettingRow
        label="Anonymous usage analytics"
        description="Help improve Steno — no meeting content is ever sent"
      >
        <Switch
          checked={telemetry.data?.telemetry_enabled ?? false}
          onCheckedChange={(v) => setTelemetry.mutate(v)}
          disabled={telemetry.data === undefined}
        />
      </SettingRow>

      {telemetry.data?.anonymous_id && (
        <div
          className="flex items-start justify-between gap-6 py-4"
          style={{ borderBottom: 'none' }}
        >
          <div className="min-w-0 flex-1">
            <div
              className="text-[14px] font-medium"
              style={{ color: 'var(--fg-1)', marginBottom: 2 }}
            >
              Anonymous ID
            </div>
            <div
              className="mb-2 text-[13px]"
              style={{ color: 'var(--fg-2)' }}
            >
              Identifies this install in analytics. Useful when reporting bugs.
            </div>
            <CopyableValue value={telemetry.data.anonymous_id} mono />
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Developer tab
// ---------------------------------------------------------------------------

function DeveloperTab() {
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
