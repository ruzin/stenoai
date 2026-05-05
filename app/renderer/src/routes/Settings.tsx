import * as React from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react';
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
import { MeetingsShell } from '@/components/MeetingsShell';
import { useNavigate, getLastNonSettingsRoute } from '@/lib/router';
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
} from '@/lib/debugLogs';
import { cn } from '@/lib/utils';
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
  useStoragePath,
  useSystemAudioSetting,
  useTelemetrySetting,
} from '@/hooks/useSettings';
import {
  useAiProvider,
  useSetAiProvider,
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
  useModels,
  usePullModel,
  useSetCurrentModel,
} from '@/hooks/useModels';
import {
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import type { AiProvider, CloudProvider } from '@/lib/ipc';

// ---------------------------------------------------------------------------
// Local style helpers — values come straight from the new design (Pencil
// bundle at /tmp/design-extract/.../Settings.jsx). Kept inline rather than
// promoted to /components/ui because they only fit the Settings layout.
// ---------------------------------------------------------------------------

const COMPACT_TRIGGER =
  'h-[30px] min-w-[150px] rounded-[6px] bg-[color:var(--surface-raised)] px-2.5 py-0 text-[13px]';
const COMPACT_BTN = 'h-[30px] px-3 text-[13px]';

const LANGUAGES: Array<{ value: string; label: string }> = [
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

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI' },
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
}: ModelCardProps) {
  return (
    <div
      className="mb-1.5 flex items-center gap-4 rounded-[8px] px-4 py-[13px] transition-colors"
      style={{
        border: `1px solid ${
          isCurrent ? 'var(--border-strong)' : 'var(--border-subtle)'
        }`,
        background: isCurrent ? 'var(--surface-raised)' : 'transparent',
        opacity: deprecated ? 0.4 : 1,
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
  const [tab, setTab] = React.useState<TabId>('general');
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
            {tab === 'ai' && <AiTab />}
            {tab === 'advanced' && <AdvancedTab />}
            {tab === 'developer' && <DeveloperTab />}
          </div>
          {tab === 'general' && (
            <div
              className="mt-10 text-center text-[12px]"
              style={{ color: 'var(--fg-muted)', maxWidth: 600 }}
            >
              StenoAI {version.data?.version ?? ''}
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
  const language = useLanguageSetting();
  const setLanguage = useSetLanguage();
  const notifications = useNotificationsSetting();
  const setNotifications = useSetNotifications();
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const dockIcon = useDockIconSetting();
  const setDockIcon = useSetDockIcon();
  const google = useGoogleCalendarAuth();
  const outlook = useOutlookCalendarAuth();

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
        label="Language"
        description="Language for transcription and summaries"
      >
        <Select
          value={language.data ?? 'en'}
          onValueChange={(v) => setLanguage.mutate(v)}
          disabled={!language.data}
        >
          <SelectTrigger className={COMPACT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
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
        description="Notify when meetings finish processing"
      >
        <Switch
          checked={notifications.data ?? false}
          onCheckedChange={(v) => setNotifications.mutate(v)}
          disabled={notifications.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Record system audio"
        description="Capture audio from virtual meetings (requires macOS 12.3+)"
      >
        <Switch
          checked={systemAudio.data ?? false}
          onCheckedChange={(v) => setSystemAudio.mutate(v)}
          disabled={systemAudio.data === undefined}
        />
      </SettingRow>

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
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI tab
// ---------------------------------------------------------------------------

function AiTab() {
  const provider = useAiProvider();
  const setProvider = useSetAiProvider();
  const current = provider.data?.ai_provider ?? 'local';

  return (
    <section data-settings-tab="ai">
      <SettingRow
        label="AI provider"
        description="Where models run. Local keeps all data on your Mac."
      >
        <Select
          value={current}
          onValueChange={(v) => setProvider.mutate(v as AiProvider)}
          disabled={!provider.data}
        >
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-72">
            <SelectItem
              value="local"
              description="Runs entirely on your Mac. Private and free, no internet required."
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
          </SelectContent>
        </Select>
      </SettingRow>

      {current === 'remote' && <RemoteProviderConfig />}
      {current === 'cloud' && <CloudProviderConfig />}

      {current !== 'cloud' && (
        <>
          <SectionHeading>Model</SectionHeading>
          <ModelList />
        </>
      )}
    </section>
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
        <ConnectionStatus result={testConnection.data} />
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
  const testConnection = useTestCloudApi();

  const cloudProvider = provider.data?.cloud_provider ?? 'openai';
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('gpt-4o-mini');

  React.useEffect(() => {
    if (provider.data) {
      setApiUrl(provider.data.cloud_api_url);
      setModel(provider.data.cloud_model);
    }
  }, [provider.data]);

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
            <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
          </SelectContent>
        </Select>
      </div>
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
          placeholder={provider.data?.cloud_api_key_set ? '••••••••' : 'sk-…'}
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
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
          onBlur={() => model && setCloudModel.mutate(model)}
          className="h-[30px] text-[13px]"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className={COMPACT_BTN}
          onClick={() => testConnection.mutate()}
          disabled={testConnection.isPending}
        >
          {testConnection.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <ConnectionStatus result={testConnection.data} />
      </div>
      <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
        Transcripts will be sent to a third-party cloud service. No audio files
        leave your device.
      </div>
    </div>
  );
}

function ConnectionStatus({
  result,
}: {
  result: { ok: boolean; message?: string } | undefined;
}) {
  if (!result) return null;
  return (
    <span
      className="flex items-center gap-1.5 text-[12px]"
      style={{ color: result.ok ? 'var(--fg-1)' : 'var(--danger)' }}
    >
      {result.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      {result.message ?? (result.ok ? 'Connected' : 'Failed')}
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

function ModelList() {
  const models = useModels();
  const current = useCurrentModel();
  const setCurrent = useSetCurrentModel();
  const pull = usePullModel();
  const [showDeprecated, setShowDeprecated] = React.useState(false);

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
    const isDefault =
      !isRemote && /\((default|recommended)\)/i.test(m.description ?? '');

    let note: string | undefined;
    if (isRemote && m.description) {
      note = m.description;
    } else if (!isRemote) {
      const parts: string[] = [];
      if (m.speed) parts.push(`${m.speed} speed`);
      if (m.quality) parts.push(`${m.quality} quality`);
      note = parts.length ? parts.join(' · ') : undefined;
    }

    const sizeLabel =
      m.size_gb !== undefined ? `${m.size_gb.toFixed(1)} GB` : undefined;

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
    </div>
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
        description="Help improve StenoAI — no meeting content is ever sent"
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
    'StenoAI debug console\nSession started — waiting for activity…\n';

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
