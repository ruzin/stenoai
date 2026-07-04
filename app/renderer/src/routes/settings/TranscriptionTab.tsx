import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useKeepRecordingsSetting,
  useLanguageSetting,
  useSetKeepRecordings,
  useSetLanguage,
} from '@/hooks/useSettings';
import {
  useParakeetModels,
  usePullParakeetModel,
  usePullWhisperModel,
  useSetActiveTranscription,
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

      <SectionHeading>Models</SectionHeading>
      <TranscriptionModelList />
    </section>
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
