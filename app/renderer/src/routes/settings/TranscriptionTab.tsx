import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

      <SectionHeading>Models</SectionHeading>
      <TranscriptionModelList />
    </section>
  );
}

/**
 * Unified Parakeet + Whisper + OpenAI-compatible ASR picker.
 * One row per model, regardless of engine — clicking [Select] on an
 * installed row activates that engine. The OpenAI ASR row additionally
 * expands config fields (API endpoint, key, model) when it is the active
 * engine.
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
      <OpenAiAsrCard
        isActive={activeEngine === 'openai-asr'}
        onActivate={() => setActive.mutate({ engine: 'openai-asr' })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenAI-compatible ASR card — Select button + config fields when active
// ---------------------------------------------------------------------------

function OpenAiAsrCard({
  isActive,
  onActivate,
}: {
  isActive: boolean;
  onActivate: () => void;
}) {
  const configQuery = useOpenAiAsrConfig();
  const setConfig = useSetOpenAiAsrConfig();

  // Local state mirrors the persisted value; saves on blur (same pattern as
  // AiTab's API key / URL fields so the behaviour feels native).
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('');

  React.useEffect(() => {
    if (configQuery.data) {
      setApiUrl(configQuery.data.api_url ?? 'https://api.openai.com/v1');
      setModel(configQuery.data.model ?? 'whisper-1');
      // Never pre-fill the key field — only show the placeholder sentinel.
    }
  }, [configQuery.data]);

  const apiKeySet = configQuery.data?.api_key_set ?? false;

  return (
    <div
      className="mb-1.5 rounded-[8px] px-4 py-[13px] transition-colors"
      style={{
        border: `1px solid ${
          isActive ? 'var(--border-strong)' : 'var(--border-subtle)'
        }`,
        background: isActive ? 'var(--surface-raised)' : 'transparent',
      }}
    >
      {/* Header row — name + Select button */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex items-baseline gap-2.5">
            <span
              className="font-mono text-[13px]"
              style={{
                color: 'var(--fg-1)',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              OpenAI-compatible ASR
            </span>
          </div>
          <div
            className="mt-0.5 text-[13px] leading-[1.5]"
            style={{ color: 'var(--fg-2)' }}
          >
            Use any OpenAI Speech-to-Text compatible API — OpenAI, Groq, Azure
            OpenAI, or a local server. No model download required; transcription
            is sent to the endpoint you configure.
          </div>
        </div>
        <div className="shrink-0">
          {isActive ? (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="h-[30px] px-3 text-[13px]"
              style={{ opacity: 0.5 }}
            >
              Selected
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-[30px] px-3 text-[13px]"
              onClick={onActivate}
            >
              Select
            </Button>
          )}
        </div>
      </div>

      {/* Config fields — always shown so users can configure before switching */}
      <div className="mt-4 space-y-3">
        {/* API endpoint */}
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

        {/* API key */}
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
              if (apiKey) setConfig.mutate({ api_key: apiKey });
            }}
            className="h-[30px] text-[13px]"
          />
        </div>

        {/* Model name */}
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
