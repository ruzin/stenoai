import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { TranscriptionEngine } from '@/lib/ipc';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAutoSummarizeSetting,
  useKeepRecordingsSetting,
  useLanguageSetting,
  useSetAutoSummarize,
  useSetKeepRecordings,
  useSetLanguage,
} from '@/hooks/useSettings';
import {
  useOpenAiAsrConfig,
  useParakeetModels,
  usePullParakeetModel,
  usePullWhisperModel,
  useSetActiveTranscription,
  useSetOpenAiAsrConfig,
  useTranscriptionEngine,
  useWhisperModels,
} from '@/hooks/useModels';
import { COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';
import { LANGUAGES_PARAKEET, LANGUAGES_WHISPER } from './languages';
import { ModelCard, formatModelSize } from './model-card';

export function TranscriptionTab() {
  const language = useLanguageSetting();
  const setLanguage = useSetLanguage();
  const keepRecordings = useKeepRecordingsSetting();
  const setKeepRecordings = useSetKeepRecordings();
  const autoSummarize = useAutoSummarizeSetting();
  const setAutoSummarize = useSetAutoSummarize();
  const engineQuery = useTranscriptionEngine();

  const engine = engineQuery.data ?? 'parakeet';
  const options = engine === 'parakeet' ? LANGUAGES_PARAKEET : LANGUAGES_WHISPER;
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
      ? 'Pick your meeting language so summaries and notes come out in it. Parakeet covers European languages; for Japanese, Chinese, Korean, Hindi or Arabic, switch to Whisper.'
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

      <SettingRow
        label="Generate notes automatically"
        description="Summarise each recording right after transcription. Turn off to stop at a transcript and generate notes on demand."
      >
        <Switch
          checked={autoSummarize.data ?? true}
          onCheckedChange={(v) => setAutoSummarize.mutate(v)}
          disabled={autoSummarize.data === undefined}
        />
      </SettingRow>

      <TranscriptionModelList />
    </section>
  );
}

/**
 * Unified Parakeet + Whisper + OpenAI-compatible ASR picker.
 * Renders a dropdown to pick the engine, then conditionally renders
 * the corresponding model list or configuration fields below it.
 */
function TranscriptionModelList() {
  const parakeet = useParakeetModels();
  const whisper = useWhisperModels();
  const engine = useTranscriptionEngine();
  const setActive = useSetActiveTranscription();
  const pullParakeet = usePullParakeetModel();
  const pullWhisper = usePullWhisperModel();

  const [showPrivacyWarning, setShowPrivacyWarning] = React.useState(false);

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

  return (
    <div className="space-y-6">
      <SettingRow
        label="Transcription engine"
        description="Where audio is processed. Local engines run entirely on-device."
      >
        <Select
          value={activeEngine}
          onValueChange={(v) => {
            if (v === 'openai-asr') {
              setShowPrivacyWarning(true);
            } else if (v === 'whisper') {
              const currentModel = whisper.data?.models.find((m) => m.name === activeWhisperModel);
              if (currentModel && !currentModel.installed) {
                pullWhisper.mutate(currentModel.name);
              } else {
                setActive.mutate({ engine: 'whisper' });
              }
            } else {
              setActive.mutate({ engine: v as TranscriptionEngine });
            }
          }}
          disabled={engine.isLoading}
        >
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-72">
            <SelectItem
              value="parakeet"
              description="Highest quality local transcription. Requires more memory."
            >
              Parakeet (Local)
            </SelectItem>
            <SelectItem
              value="whisper"
              description="Best accuracy local transcription across many languages."
            >
              Whisper (Local)
            </SelectItem>
            <SelectItem
              value="openai-asr"
              description="Use any OpenAI-compatible API. Requires internet."
            >
              Cloud API (OpenAI-compatible)
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {activeEngine === 'parakeet' && (
        <div>
          <SectionHeading>Model</SectionHeading>
          {parakeetRows.map((row) => (
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
      )}

      {activeEngine === 'whisper' && (
        <div>
          <SectionHeading>Model</SectionHeading>
          {whisperRows.map((row) => (
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
      )}

      {activeEngine === 'openai-asr' && <OpenAiAsrConfig />}

      <ConfirmDialog
        open={showPrivacyWarning}
        onOpenChange={setShowPrivacyWarning}
        title="Enable Cloud Transcription"
        description="Your transcript will be sent to the configured cloud API for transcription, which means your audio and text will leave your device. Your privacy may be at risk depending on the provider you configure. Do you understand and wish to proceed?"
        confirmLabel="I understand"
        cancelLabel="Cancel"
        onConfirm={() => {
          setActive.mutate({ engine: 'openai-asr' });
          setShowPrivacyWarning(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenAI-compatible ASR Config
// ---------------------------------------------------------------------------

function OpenAiAsrConfig() {
  const configQuery = useOpenAiAsrConfig();
  const setConfig = useSetOpenAiAsrConfig();

  // Local state mirrors the persisted value; saves on blur (same pattern as
  // AiTab's API key / URL fields so the behaviour feels native).
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('');

  // Sync state from query when it resolves/changes (React recommended pattern vs useEffect)
  const [prevConfig, setPrevConfig] = React.useState(configQuery.data);
  if (configQuery.data !== prevConfig) {
    setPrevConfig(configQuery.data);
    if (configQuery.data) {
      setApiUrl(configQuery.data.api_url ?? 'https://api.openai.com/v1');
      setModel(configQuery.data.model ?? 'whisper-1');
    }
  }

  const apiKeySet = configQuery.data?.api_key_set ?? false;

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
          API endpoint
        </label>
        <Input
          id="openai-asr-api-url"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          onBlur={() => {
            if (apiUrl !== (configQuery.data?.api_url ?? '')) {
              setConfig.mutate({ api_url: apiUrl });
            }
          }}
          className="h-[30px] text-[13px]"
        />
      </div>

      <div>
        <label
          className="mb-1 block text-[12px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--fg-muted)' }}
        >
          API key
        </label>
        <Input
          id="openai-asr-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={apiKeySet ? '••••••••' : 'sk-…'}
          onBlur={() => {
            if (apiKey !== '' || apiKeySet) {
              setConfig.mutate({ api_key: apiKey });
            }
          }}
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
          id="openai-asr-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="whisper-1"
          onBlur={() => {
            if (model && model !== (configQuery.data?.model ?? '')) {
              setConfig.mutate({ model });
            }
          }}
          className="h-[30px] text-[13px]"
        />
      </div>

      {/* Hint */}
      <div
        className="mt-2 text-[12px]"
        style={{ color: 'var(--fg-muted)' }}
      >
        Examples: OpenAI → <code>whisper-1</code> · Groq →{' '}
        <code>whisper-large-v3</code> · Azure → your deployment name
      </div>
    </div>
  );
}
