import * as React from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  usePullModel,
  useSetCurrentModel,
  useSwitchToFasterBuild,
} from '@/hooks/useModels';
import { useOrgSession } from '@/hooks/useOrg';
import { COMPACT_BTN, COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';
import { ModelCard, formatModelSize, isDefaultModel } from './model-card';

export function AiTab() {
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

function ModelList() {
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
        description: `${match.name} (${formatModelSize(match.size_gb) ?? 'unknown size'}) is no longer needed now that the faster build is active. Delete it to free up disk space?`,
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
      const parts: string[] = [];
      if (m.speed) parts.push(`${m.speed} speed`);
      if (m.quality) parts.push(`${m.quality} quality`);
      note = parts.length ? parts.join(' · ') : undefined;
    }

    // The NVFP4 blob is a different (often larger) download than the GGUF
    // entry's own size -- show it instead whenever NVFP4 is what's actually
    // installed, or (nothing installed yet) what "Select" will actually
    // pull on Apple Silicon. Otherwise (GGUF installed, no NVFP4) the GGUF
    // size is what's really on disk.
    const showMlxSize = m.mlxTag && m.mlxSizeGb !== undefined && (m.mlxInstalled || !m.ggufInstalled);
    const sizeLabel = formatModelSize(showMlxSize ? m.mlxSizeGb : m.size_gb);
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
      const label = tags.length > 1 ? `${m.name} and its faster build` : tags[0];
      const pronoun = tags.length > 1 ? 'them' : 'it';
      setDeleteCandidate({
        tags,
        description: `Delete ${label} (${sizeLabel ?? 'unknown size'}) to free up disk space? You can re-download ${pronoun} anytime.`,
      });
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
          title="Delete model?"
          description={deleteCandidate.description}
          confirmLabel="Delete"
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
