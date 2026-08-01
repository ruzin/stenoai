import * as React from 'react';
import { Building2, Check, ChevronDown, ChevronRight, Cloud, Laptop, Loader2, Server, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OpenAiIcon } from '@/components/ui/openai-icon';
import { AnthropicIcon } from '@/components/ui/anthropic-icon';
import { AwsIcon } from '@/components/ui/aws-icon';
import { NvidiaIcon } from '@/components/ui/nvidia-icon';
import { GoogleIcon } from '@/components/ui/google-icon';
import { MetaIcon } from '@/components/ui/meta-icon';
import { QwenIcon } from '@/components/ui/qwen-icon';
import { cn } from '@/lib/utils';
import type { AiProvider, CloudProvider } from '@/lib/ipc';
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
  useAutoSummarizeSetting,
  useKeepRecordingsSetting,
  useLanguageSetting,
  useSetAutoSummarize,
  useSetKeepRecordings,
  useSetLanguage,
} from '@/hooks/useSettings';
import { useOrgSession } from '@/hooks/useOrg';
import { COMPACT_BTN, COMPACT_INPUT, COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';
import { ModelCard, formatModelSize, isDefaultModel, parsePullPercent } from './model-card';
import { modelMayExceedMemory } from './model-memory';
import { LANGUAGES_PARAKEET, LANGUAGES_WHISPER } from './languages';
import { languageLabel } from '@/lib/transcription-languages';

export function AiTab() {
  const { t } = useTranslation();
  return (
    <section data-settings-tab="ai">
      <SectionHeading>{t('settings.ai.transcription.heading')}</SectionHeading>
      <p
        className="text-[13px] leading-[1.5]"
        style={{ color: 'var(--fg-2)', marginBottom: 4 }}
      >
        {t('settings.ai.transcription.intro')}
      </p>
      <TranscriptionSection />

      <SectionHeading>{t('settings.ai.summarisation.heading')}</SectionHeading>
      <p
        className="text-[13px] leading-[1.5]"
        style={{ color: 'var(--fg-2)', marginBottom: 4 }}
      >
        {t('settings.ai.summarisation.intro')}
      </p>
      <SummarisationSection />
    </section>
  );
}

function TranscriptionSection() {
  const { t } = useTranslation();
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

  return (
    // Retains the pre-merge data-settings-tab="transcription" identity as a
    // nested wrapper (the page-level section is now data-settings-tab="ai").
    <div data-settings-tab="transcription">
      <SettingRow
        label={t('settings.ai.language.label')}
        description={t('settings.ai.language.description')}
      >
        <Select
          value={displayValue}
          onValueChange={(v) => setLanguage.mutate(v)}
          disabled={!language.data}
        >
          {/* Explicit testid: the Model dropdown below is a second combobox in
              this section now, so parakeet-language-picker.t1 can no longer
              assume "the only combobox" to find this trigger. */}
          <SelectTrigger className={COMPACT_TRIGGER} data-testid="transcription-language-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {languageLabel(l.value, l.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label={t('settings.ai.keepRecordings.label')}
        description={t('settings.ai.keepRecordings.description')}
      >
        <Switch
          checked={keepRecordings.data ?? false}
          onCheckedChange={(v) => setKeepRecordings.mutate(v)}
          disabled={keepRecordings.data === undefined}
        />
      </SettingRow>

      <TranscriptionModelList />
    </div>
  );
}

// Tight, model-specific taglines for the dropdown items -- deliberately not
// the backend's longer `description` strings (those are written for the
// old card layout's note line). Keyed by engine since each only ever has
// one supported model today (see SUPPORTED_PARAKEET_MODELS /
// SUPPORTED_WHISPER_MODELS in the Python registries). Values are translation
// keys, resolved where the dropdown is rendered.
const ENGINE_TAGLINE_KEY: Record<'parakeet' | 'whisper', string> = {
  parakeet: 'settings.ai.engine.parakeet',
  whisper: 'settings.ai.engine.whisper',
};

/**
 * Parakeet vs. Whisper picker, as a single dropdown -- each engine has
 * exactly one supported model today, so this is really an engine switch,
 * not a long model list. Icons attribute the model's maker (Whisper ->
 * OpenAI, Parakeet -> NVIDIA); neither is a provider you configure
 * (transcription is always local either way).
 *
 * Picking an installed engine switches immediately. Picking one that isn't
 * installed starts a download and the trigger shows the pending target
 * (icon + name) plus an inline spinner (Parakeet only reports coarse
 * stage, no percent) or live percent (Whisper). The trigger is disabled
 * for the whole download -- neither pull hook guards against a second,
 * concurrent download of the other engine, so this is the only thing
 * stopping a switch-mid-download race where whichever download finishes
 * last silently wins.
 */
function TranscriptionModelList() {
  const { t } = useTranslation();
  const parakeet = useParakeetModels();
  const whisper = useWhisperModels();
  const engine = useTranscriptionEngine();
  const setActive = useSetActiveTranscription();
  const pullParakeet = usePullParakeetModel();
  const pullWhisper = usePullWhisperModel();

  const isLoading = parakeet.isLoading || whisper.isLoading || engine.isLoading;
  const isError = parakeet.isError || whisper.isError || engine.isError;

  // Keep the row's own label/description in place and swap only the
  // dropdown slot for a same-sized placeholder — replacing the whole row
  // with a bare "Loading models…" line dropped the label/description and
  // caused a layout jump once the real dropdown appeared.
  if (isLoading) {
    return (
      <SettingRow
        label={t('settings.ai.model.label')}
        description={t('settings.ai.model.description')}
        noBorder
      >
        <div
          className={cn(COMPACT_TRIGGER, 'w-[190px] flex items-center gap-1.5')}
          style={{ color: 'var(--fg-muted)' }}
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate">{t('settings.ai.models.loading')}</span>
        </div>
      </SettingRow>
    );
  }
  if (isError) {
    return (
      <SettingRow
        label={t('settings.ai.model.label')}
        description={t('settings.ai.model.description')}
        noBorder
      >
        <div className={cn(COMPACT_TRIGGER, 'w-[190px] flex items-center')} style={{ color: 'var(--fg-2)' }}>
          <span className="truncate">{t('settings.ai.model.loadError')}</span>
        </div>
      </SettingRow>
    );
  }

  const parakeetModel = parakeet.data?.models[0];
  const whisperModel = whisper.data?.models[0];
  if (!parakeetModel || !whisperModel) return null;

  const activeEngine = engine.data ?? 'parakeet';
  // pull-*-model's IPC handle resolves only once the whole download (or a
  // failure/timeout) settles -- so the mutation's own isPending spans the
  // full download, unlike the progress dict which only lights up once the
  // first progress event arrives.
  const parakeetDownloading = pullParakeet.isPending;
  const whisperDownloading = pullWhisper.isPending;
  const downloadingEngine = parakeetDownloading ? 'parakeet' : whisperDownloading ? 'whisper' : null;
  const isDownloading = downloadingEngine !== null;
  const value = downloadingEngine ?? activeEngine;

  const options: Array<{
    engine: 'parakeet' | 'whisper';
    model: typeof parakeetModel;
    icon: React.ReactNode;
  }> = [
    { engine: 'parakeet', model: parakeetModel, icon: <NvidiaIcon size={12} /> },
    { engine: 'whisper', model: whisperModel, icon: <OpenAiIcon size={12} /> },
  ];
  const current = options.find((o) => o.engine === value)!;
  const whisperPercent =
    downloadingEngine === 'whisper' ? parsePullPercent(pullWhisper.progress[whisperModel.name]) : null;

  const onValueChange = (next: string) => {
    if (next === activeEngine) return;
    if (next === 'parakeet') {
      if (parakeetModel.installed) {
        setActive.mutate({ engine: 'parakeet' });
      } else {
        pullParakeet.mutate(parakeetModel.name);
      }
    } else if (whisperModel.installed) {
      setActive.mutate({ engine: 'whisper', whisperModel: whisperModel.name });
    } else {
      pullWhisper.mutate(whisperModel.name);
    }
  };

  return (
    <SettingRow
      label={t('settings.ai.model.label')}
      description={t('settings.ai.model.description')}
      noBorder
    >
      <Select value={value} onValueChange={onValueChange} disabled={isDownloading}>
        <SelectTrigger
          className={cn(COMPACT_TRIGGER, 'w-[190px]')}
          data-testid="transcription-model-select"
        >
          {/* A plain div, not a span: SelectTrigger applies
              `[&>span]:line-clamp-1` to any direct-child span, and
              line-clamp's `display: -webkit-box` clobbers this row's
              `inline-flex`, stacking the icon above the name instead of
              beside it. */}
          <div className="flex min-w-0 items-center gap-1.5">
            {current.icon}
            <span className="truncate">{current.model.displayName ?? current.model.name}</span>
            {isDownloading &&
              (whisperPercent !== null ? (
                <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--fg-muted)' }}>
                  {whisperPercent}%
                </span>
              ) : (
                <Loader2 className="size-3 shrink-0 animate-spin" style={{ color: 'var(--fg-muted)' }} />
              ))}
          </div>
        </SelectTrigger>
        <SelectContent className="w-72">
          {options.map((o) => (
            <SelectItem
              key={o.engine}
              value={o.engine}
              description={t(ENGINE_TAGLINE_KEY[o.engine])}
            >
              <span className="inline-flex items-center gap-1.5">
                {o.icon}
                {o.model.displayName ?? o.model.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function SummarisationSection() {
  const { t } = useTranslation();
  const provider = useAiProvider();
  const setProvider = useSetAiProvider();
  const orgSession = useOrgSession();
  const autoSummarize = useAutoSummarizeSetting();
  const setAutoSummarize = useSetAutoSummarize();
  const current = provider.data?.ai_provider ?? 'local';
  const orgSignedIn = orgSession.data?.signedIn ?? false;

  return (
    <>
      <SettingRow
        label={t('settings.ai.autoSummarize.label')}
        description={t('settings.ai.autoSummarize.description')}
      >
        <Switch
          checked={autoSummarize.data ?? true}
          onCheckedChange={(v) => setAutoSummarize.mutate(v)}
          disabled={autoSummarize.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label={t('settings.ai.provider.label')}
        description={
          orgSignedIn
            ? t('settings.ai.provider.orgManaged')
            : t('settings.ai.provider.description')
        }
        // The Model section right below (local provider) has no divider of
        // its own — Remote/Cloud/Adapter's config blocks do (their own
        // bottom border), so they still want this row's divider to separate
        // from it.
        noBorder={current !== 'cloud' && current !== 'adapter' && !orgSignedIn}
      >
        <Select
          value={current}
          onValueChange={(v) => setProvider.mutate(v as AiProvider)}
          disabled={!provider.data || orgSignedIn}
        >
          <SelectTrigger
            className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}
            data-testid="ai-provider-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-72">
            <SelectItem
              value="local"
              icon={<Laptop className="size-4" />}
              description={t('settings.ai.provider.localDescription')}
            >
              {t('settings.ai.provider.local')}
            </SelectItem>
            <SelectItem
              value="remote"
              icon={<Server className="size-4" />}
              description={t('settings.ai.provider.remoteDescription')}
            >
              {t('settings.ai.provider.remote')}
            </SelectItem>
            <SelectItem
              value="cloud"
              icon={<Cloud className="size-4" />}
              description={t('settings.ai.provider.cloudDescription')}
            >
              {t('settings.ai.provider.cloud')}
            </SelectItem>
            <SelectItem
              value="adapter"
              disabled={!orgSignedIn}
              icon={<Building2 className="size-4" />}
              description={
                orgSignedIn
                  ? t('settings.ai.provider.adapterDescription')
                  : t('settings.ai.provider.adapterDisabledDescription')
              }
            >
              {t('settings.ai.provider.adapter')}
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
          provider value is momentarily stale.
          Labelled like a SettingRow (not SectionHeading) -- this is still
          part of Summarisation & Chat, just a row whose control is a list
          of cards instead of a single trigger, so SectionHeading's
          top-level weight read as its own section on the page. */}
      {current !== 'cloud' && current !== 'adapter' && !orgSignedIn && (
        <div style={{ marginTop: '20px' }}>
          <div className="text-[14px] font-normal" style={{ color: 'var(--fg-1)', marginBottom: 2 }}>
            {t('settings.ai.summaryModel.label')}
          </div>
          <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--fg-2)', marginBottom: 8 }}>
            {t('settings.ai.summaryModel.description')}
          </p>
          <ModelList />
        </div>
      )}
    </>
  );
}

/** Adapter mode has no per-user configuration — the customer's IT
 *  controls the model + API key on the adapter side. This block just
 *  reassures the user it's working (or warns them if their session has
 *  lapsed, in which case summarisation would fall back to an error). */
function AdapterProviderInfo({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className="space-y-2 py-4 text-[12px]"
      style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--fg-2)' }}
    >
      {signedIn ? (
        <p>{t('settings.ai.adapter.signedIn')}</p>
      ) : (
        <p style={{ color: 'var(--accent-danger, var(--fg-1))' }}>
          {/* Trans, not two t() calls: the emphasised settings path sits mid
              sentence, and splitting it into prefix/suffix keys would strand
              translators with fragments no other language can reorder. */}
          <Trans
            i18nKey="settings.ai.adapter.signedOut"
            components={{ strong: <strong /> }}
          />
        </p>
      )}
    </div>
  );
}

function RemoteProviderConfig() {
  const { t } = useTranslation();
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
          {t('settings.ai.remote.urlLabel')}
        </label>
        <Input
          value={url}
          onChange={(e) => setLocalUrl(e.target.value)}
          placeholder="http://192.168.1.100:11434"
          onBlur={() => url && setUrl.mutate(url)}
          className="h-[30px] bg-[color:var(--surface-raised)] text-[13px]"
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
          {testConnection.isPending
            ? t('settings.ai.connection.testing')
            : t('settings.ai.connection.test')}
        </Button>
        <ConnectionStatus
          ok={testConnection.isSuccess ? testConnection.data?.ok ?? true : testConnection.isError ? false : undefined}
          message={
            testConnection.isError
              ? testConnection.error instanceof Error
                ? testConnection.error.message
                : t('settings.ai.connection.failed')
              : testConnection.data?.message
          }
        />
      </div>
    </div>
  );
}

const CLOUD_SERVICE_ICON: Record<CloudProvider, React.ReactNode> = {
  openai: <OpenAiIcon size={12} />,
  anthropic: <AnthropicIcon size={12} />,
  bedrock: <AwsIcon size={12} />,
  custom: null,
};

function CloudProviderConfig() {
  const { t } = useTranslation();
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
          {t('settings.ai.cloud.serviceLabel')}
        </label>
        <Select
          value={cloudProvider}
          onValueChange={(v) => setCloudProvider.mutate(v as CloudProvider)}
        >
          <SelectTrigger className={COMPACT_INPUT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">
              <span className="inline-flex items-center gap-1.5">
                {CLOUD_SERVICE_ICON.openai}
                OpenAI
              </span>
            </SelectItem>
            <SelectItem value="anthropic">
              <span className="inline-flex items-center gap-1.5">
                {CLOUD_SERVICE_ICON.anthropic}
                Anthropic (Claude)
              </span>
            </SelectItem>
            <SelectItem value="bedrock">
              <span className="inline-flex items-center gap-1.5">
                {CLOUD_SERVICE_ICON.bedrock}
                AWS Bedrock (Claude)
              </span>
            </SelectItem>
            <SelectItem value="custom">{t('settings.ai.cloud.custom')}</SelectItem>
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
              {t('settings.ai.cloud.regionLabel')}
            </label>
            <Input
              value={bedrockRegion}
              onChange={(e) => setBedrockRegionState(e.target.value)}
              placeholder="us-east-1"
              onBlur={() =>
                bedrockRegion && setBedrockRegion.mutate(bedrockRegion)
              }
              className={COMPACT_INPUT}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-[12px] font-medium uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
            >
              {t('settings.ai.cloud.inferenceProfileLabel')}
            </label>
            <Input
              value={bedrockProfile}
              onChange={(e) => setBedrockProfileState(e.target.value)}
              placeholder="us.anthropic.claude-…"
              onBlur={() => setBedrockProfile.mutate(bedrockProfile.trim())}
              className={COMPACT_INPUT}
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
            {t('settings.ai.cloud.apiUrlLabel')}
          </label>
          <Input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            onBlur={() => apiUrl && setCloudUrl.mutate(apiUrl)}
            className={COMPACT_INPUT}
          />
        </div>
      )}
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          {t('settings.ai.cloud.apiKeyLabel')}
        </label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            provider.data?.cloud_api_key_set
              ? '••••••••'
              : cloudProvider === 'bedrock'
                ? t('settings.ai.cloud.apiKeyPlaceholderBedrock')
                : cloudProvider === 'anthropic'
                  ? 'sk-ant-…'
                  : 'sk-…'
          }
          onBlur={() => apiKey && setCloudKey.mutate(apiKey)}
          className={COMPACT_INPUT}
        />
      </div>
      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          {t('settings.ai.cloud.modelLabel')}
        </label>
        {showModelDropdown ? (
          <Select value={model} onValueChange={onModelSelect}>
            <SelectTrigger className={COMPACT_INPUT}>
              <SelectValue placeholder={t('settings.ai.cloud.selectModelPlaceholder')} />
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
              <SelectItem value="__custom__">{t('settings.ai.cloud.customOption')}</SelectItem>
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
              className={COMPACT_INPUT}
            />
            {availableModels.length > 0 && customModelMode && (
              <Button
                variant="ghost"
                size="sm"
                className={COMPACT_BTN}
                onClick={() => setCustomModelMode(false)}
              >
                {t('settings.ai.cloud.pickFromList')}
              </Button>
            )}
          </div>
        )}
        {availableModels.length === 0 && cloudProvider !== 'bedrock' && (
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--fg-muted)' }}>
            {t('settings.ai.cloud.testToLoadModels')}
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
          {testConnection.isPending
            ? t('settings.ai.connection.testing')
            : t('settings.ai.connection.test')}
        </Button>
        <ConnectionStatus
          ok={testConnection.isSuccess ? true : testConnection.isError ? false : undefined}
          message={
            testConnection.isError
              ? testConnection.error instanceof Error
                ? testConnection.error.message
                : t('settings.ai.connection.failed')
              : testConnection.isSuccess && testConnection.data?.models
                ? t('settings.ai.cloud.modelsAvailable', {
                    count: testConnection.data.models.length,
                  })
                : undefined
          }
        />
      </div>
      <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
        {t('settings.ai.cloud.disclaimer')}
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
  const { t } = useTranslation();
  if (ok === undefined) return null;
  return (
    <span
      className="flex items-center gap-1.5 text-[12px]"
      style={{ color: ok ? 'var(--fg-1)' : 'var(--danger)' }}
    >
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      {message ??
        (ok ? t('settings.ai.connection.connected') : t('settings.ai.connection.failed'))}
    </span>
  );
}

// Attribution icon for the local Ollama model list -- matched by prefix
// against the model id (e.g. "gemma4:e2b-it-qat"), not the display name,
// since ids are the stable identifier. Remote-provider models can be
// anything a user's Ollama server has pulled, so unmatched ids just render
// without an icon rather than guessing.
function getOllamaModelIcon(modelId: string): React.ReactNode | undefined {
  if (modelId.startsWith('gemma')) return <GoogleIcon size={12} />;
  if (modelId.startsWith('llama')) return <MetaIcon size={12} />;
  if (modelId.startsWith('qwen')) return <QwenIcon size={12} />;
  if (modelId.startsWith('gpt-oss') || modelId.startsWith('gpt')) return <OpenAiIcon size={12} />;
  return undefined;
}

function ModelList() {
  const { t } = useTranslation();
  const models = useModels();
  const current = useCurrentModel();
  const setCurrent = useSetCurrentModel();
  const pull = usePullModel();
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  // Backs two distinct triggers that both end in "confirm, then delete one or
  // more tags": the automatic post-switch offer to remove the now-redundant
  // GGUF build, and the manual "delete this model to free up disk space"
  // action. Only one delete can be in flight/confirmed at a time in this UI,
  // so a single piece of state covers both.
  const [deleteCandidate, setDeleteCandidate] = React.useState<{ tags: string[]; description: string } | null>(
    null,
  );
  const deleteModel = useDeleteModel();
  const fasterBuild = useSwitchToFasterBuild((mlxTag) => {
    const match = models.data?.models.find((m) => m.mlxTag === mlxTag);
    if (match) {
      setDeleteCandidate({
        tags: [match.name],
        description: t('settings.ai.models.deleteFasterBuildDescription', {
          name: match.name,
          size: formatModelSize(match.size_gb) ?? t('settings.ai.models.unknownSize'),
        }),
      });
    }
  });

  if (models.isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-[13px]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Loader2 className="size-3.5 animate-spin" />
        {t('settings.ai.models.loading')}
      </div>
    );
  }
  if (models.isError) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
        {t('settings.ai.models.ollamaUnreachable')}
      </div>
    );
  }
  if (!models.data?.models?.length) {
    return (
      <div className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
        {t('settings.ai.models.none')}
      </div>
    );
  }

  const isRemote = models.data.provider === 'remote';
  // The RAM-suitability badge only makes sense for the bundled local Ollama:
  // for remote-Ollama or any cloud provider the model runs off-machine, so
  // this Mac's memory is irrelevant. Gate strictly on 'local'.
  const isLocal = models.data.provider === 'local';
  const totalRamGb = models.data.totalRamGb;
  const sorted = [...models.data.models].sort(
    (a, b) => (a.deprecated ? 1 : 0) - (b.deprecated ? 1 : 0),
  );
  const active = sorted.filter((m) => !m.deprecated);
  const deprecated = sorted.filter((m) => m.deprecated);

  const renderCard = (m: (typeof sorted)[number]) => {
    const isCurrent = m.name === current.data;
    // On Apple Silicon, an uninstalled model is pulled straight to its NVFP4
    // sibling (matching what first-run setup's pull_target already does) --
    // config.json still ends up with the canonical GGUF id via models.set()
    // (see usePullModel's pendingSelect), but the actual download, and so
    // the IPC events this row's progress/cancel keys off of, are for the
    // NVFP4 tag. Off Apple Silicon (no mlxTag) this is just m.name, same as
    // before.
    const pullTarget = m.mlxTag ?? m.name;
    const isFasterBuildActive = fasterBuild.activeTag === m.mlxTag;
    // A "switch to faster build" pulls the SAME -nvfp4 tag a general "Select"
    // would, and usePullModel's progress listener is a global (unfiltered) IPC
    // subscription -- so it records that tag's progress too. Without this guard
    // pull.progress[pullTarget] lights up during a switch, and the card renders
    // a SECOND, duplicate progress bar (plus a duplicate Cancel) on top of the
    // faster-build one. While a switch is in flight the faster-build block owns
    // that UI, so suppress the general-download surface for this row.
    const isDownloading = Boolean(pull.progress[pullTarget]) && !isFasterBuildActive;
    const downloadProgress = isDownloading ? pull.progress[pullTarget] : undefined;
    const isDefault = !isRemote && isDefaultModel(m.description);

    let note: string | undefined;
    if (isRemote && m.description) {
      note = m.description;
    } else if (!isRemote) {
      // The speed/quality VALUES ("fast", "excellent") come from the backend
      // registry and stay as-is; only the frame around them is translated.
      const parts: string[] = [];
      if (m.speed) parts.push(t('settings.ai.models.speedNote', { value: m.speed }));
      if (m.quality) parts.push(t('settings.ai.models.qualityNote', { value: m.quality }));
      note = parts.length ? parts.join(' · ') : undefined;
    }

    // The NVFP4 blob is a different (often larger) download than the GGUF
    // entry's own size -- show it instead whenever NVFP4 is what's actually
    // installed, or (nothing installed yet) what "Select" will actually
    // pull on Apple Silicon. Otherwise (GGUF installed, no NVFP4) the GGUF
    // size is what's really on disk.
    const showMlxSize = m.mlxTag && m.mlxSizeGb !== undefined && (m.mlxInstalled || !m.ggufInstalled);
    const sizeLabel = formatModelSize(showMlxSize ? m.mlxSizeGb : m.size_gb);
    const memoryWarning = isLocal && modelMayExceedMemory(m.size_gb, totalRamGb);
    const fasterBuildBlocked =
      Boolean(fasterBuild.activeTag) &&
      !isFasterBuildActive &&
      (fasterBuild.state === 'pulling' || fasterBuild.state === 'verifying' || fasterBuild.state === 'done');

    const onSelect = () => {
      if (m.installed) {
        setCurrent.mutate(m.name);
      } else {
        pull.mutate({ name: m.name, pullTarget });
      }
    };

    const onDeleteModel = () => {
      // Only tags actually present in Ollama -- a model pulled straight to
      // its NVFP4 tag (general "Select" on Apple Silicon) never has the
      // GGUF blob itself installed, and ollama.delete() on a tag that was
      // never pulled throws. Blindly including m.name here caused exactly
      // that: a stuck confirm dialog on a model with no GGUF blob.
      const tags: string[] = [];
      if (m.ggufInstalled) tags.push(m.name);
      if (m.mlxInstalled && m.mlxTag) tags.push(m.mlxTag);
      if (tags.length === 0) return;
      // Two whole-sentence keys rather than one with a pronoun/label hole —
      // "it"/"them" and "X and its faster build" don't survive translation as
      // interchangeable fragments.
      setDeleteCandidate({
        tags,
        description:
          tags.length > 1
            ? t('settings.ai.models.deleteDescriptionBoth', {
                name: m.name,
                size: sizeLabel ?? t('settings.ai.models.unknownSize'),
              })
            : t('settings.ai.models.deleteDescriptionOne', {
                name: tags[0],
                size: sizeLabel ?? t('settings.ai.models.unknownSize'),
              }),
      });
    };

    return (
      <ModelCard
        key={m.name}
        icon={getOllamaModelIcon(m.name)}
        name={m.name}
        sizeLabel={sizeLabel}
        note={note}
        isCurrent={isCurrent}
        isDefault={isDefault}
        deprecated={Boolean(m.deprecated)}
        memoryWarning={memoryWarning}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        downloadBytesPerSecond={pull.bytesPerSecond[pullTarget]}
        onSelect={onSelect}
        onCancelDownload={() => pull.cancel(pullTarget)}
        isInstalled={Boolean(m.installed)}
        onDeleteModel={onDeleteModel}
        ggufInstalled={Boolean(m.ggufInstalled)}
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
        onCancelFasterBuild={isFasterBuildActive ? fasterBuild.cancel : undefined}
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
            {showDeprecated
              ? t('settings.ai.models.hideDeprecated')
              : t('settings.ai.models.showDeprecated')}
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
          title={t('settings.ai.models.deleteTitle')}
          description={deleteCandidate.description}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={async () => {
            // finally, not just a trailing statement: a delete call
            // rejecting (unexpected -- e.g. Ollama briefly unreachable)
            // must not leave this dialog stuck open with no way to close
            // it except Cancel (which, since some deletes may have already
            // succeeded, looked like "cancel deletes it anyway").
            // allSettled (not all): waits for every tag's attempt to finish
            // rather than returning as soon as the first one rejects, so the
            // dialog doesn't close while a sibling delete is still pending.
            try {
              const results = await Promise.allSettled(
                deleteCandidate.tags.map((tag) => deleteModel.mutateAsync(tag)),
              );
              const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
              if (failed.length > 0) {
                // eslint-disable-next-line no-console -- no toast/error-surface system exists yet; at least don't fail silently.
                console.error('Failed to delete some model tags:', failed.map((f) => f.reason));
              }
            } finally {
              setDeleteCandidate(null);
              fasterBuild.reset();
            }
          }}
        />
      )}
    </div>
  );
}
