import * as React from 'react';
import { Check, Cloud, HardDrive, Mic, MessageSquare, Zap, X } from 'lucide-react';
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
import { Display, Lead, Muted } from '@/components/ui/typography';
import { useNavigate } from '@/lib/router';
import { useCheckMicPermission, useRequestMicPermission, useSetupStep } from '@/hooks/useSetup';
import {
  useSetTelemetry,
  useSetUserName,
  useTelemetrySetting,
  useUserName,
} from '@/hooks/useSettings';
import {
  useSetAiProvider,
  useSetCloudApiKey,
  useSetCloudProvider,
  useTestCloudApi,
} from '@/hooks/useAi';
import { ipc, type CloudProvider } from '@/lib/ipc';
import { cn } from '@/lib/utils';

type StepStatus = 'waiting' | 'running' | 'done' | 'failed';

interface Step {
  id: 'microphone' | 'whisper' | 'ollama';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: StepStatus;
  detail?: string;
}

function Badge({ status }: { status: StepStatus }) {
  const label =
    status === 'waiting'
      ? 'Waiting'
      : status === 'running'
        ? 'Running'
        : status === 'done'
          ? 'Done'
          : 'Failed';
  const cls =
    status === 'done'
      ? 'bg-muted text-foreground'
      : status === 'running'
        ? 'bg-foreground text-background'
        : status === 'failed'
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-transparent text-muted-foreground border border-border';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function StepCard({ step }: { step: Step }) {
  const Icon = step.icon;
  return (
    <div
      className="flex items-center gap-4 rounded-md border border-border p-4"
      data-setup-step={step.id}
      data-setup-status={step.status}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        {step.status === 'done' ? <Check className="size-5" /> : step.status === 'failed' ? <X className="size-5" /> : <Icon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">{step.title}</div>
          <Badge status={step.status} />
        </div>
        <Muted className="mt-0.5">{step.detail ?? step.description}</Muted>
      </div>
    </div>
  );
}

export function Setup() {
  const navigate = useNavigate();
  const [statuses, setStatuses] = React.useState<Record<Step['id'], StepStatus>>({
    microphone: 'waiting',
    whisper: 'waiting',
    ollama: 'waiting',
  });
  const [details, setDetails] = React.useState<Record<Step['id'], string | undefined>>({
    microphone: undefined,
    whisper: undefined,
    ollama: undefined,
  });
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [debugOpen, setDebugOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.stenoai) return;
    return ipc().on.debugLog((line) => {
      setLogs((prev) => {
        const next = [...prev, line];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
  }, []);

  const checkMic = useCheckMicPermission();
  const requestMic = useRequestMicPermission();
  const whisperStep = useSetupStep('whisper');
  const ollamaStep = useSetupStep('ollamaAndModel');

  // Telemetry choice surfaced here so users opt in/out during onboarding
  // instead of having to find Settings → Advanced afterwards. Persists
  // immediately via the same backend used by the Settings page.
  const telemetry = useTelemetrySetting();
  const setTelemetry = useSetTelemetry();
  const telemetryEnabled = telemetry.data?.telemetry_enabled ?? true;

  // First name powers the in-app greeting ("Hi <name>, ask anything"). Stored
  // locally only — never sent anywhere. Persisted on blur to avoid a write
  // per keystroke.
  const userName = useUserName();
  const setUserName = useSetUserName();
  const [name, setName] = React.useState('');
  // Sync once when the initial fetch resolves so we don't clobber user input.
  // Wait for the real query to settle — placeholderData (sessionStorage cache)
  // could be stale or empty, and we don't want to seed from it and then ignore
  // the canonical value when it arrives from disk.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    if (userName.isPending || userName.isPlaceholderData) return;
    if (userName.data !== undefined) {
      setName(userName.data);
      seededRef.current = true;
    }
  }, [userName.data, userName.isPending, userName.isPlaceholderData]);
  const persistName = () => {
    const trimmed = name.trim();
    if (trimmed === (userName.data ?? '')) return;
    setUserName.mutate(trimmed);
  };

  // Summarization-engine choice. 'local' downloads the bundled model
  // (privacy + free, slower); 'cloud' wires up an API key (no download,
  // higher quality) and skips the third install step entirely.
  type SummaryMode = 'local' | 'cloud';
  const [summaryMode, setSummaryMode] = React.useState<SummaryMode>('local');
  const [cloudProvider, setCloudProviderChoice] = React.useState<CloudProvider>('openai');
  const [cloudApiKey, setCloudApiKey] = React.useState('');
  const setAiProvider = useSetAiProvider();
  const setCloudProviderMut = useSetCloudProvider();
  const setCloudKeyMut = useSetCloudApiKey();
  const testCloudApi = useTestCloudApi();

  const cloudReady = summaryMode === 'cloud' && cloudApiKey.trim().length > 0;
  const canBegin = summaryMode === 'local' || cloudReady;

  const setStatus = (id: Step['id'], s: StepStatus, detail?: string) => {
    setStatuses((prev) => ({ ...prev, [id]: s }));
    if (detail !== undefined) setDetails((prev) => ({ ...prev, [id]: detail }));
  };

  const runSetup = async () => {
    setRunning(true);
    setDone(false);
    // Capture the snapshot so we can branch on what's already done. Skipping
    // completed steps keeps retries fast (no re-prompting for mic permission,
    // no re-initialising Whisper) when the user is just fixing a bad API key.
    const snapshot = statuses;
    try {
      if (snapshot.microphone !== 'done') {
        setStatus('microphone', 'running', 'Checking permission...');
        const existing = await checkMic.mutateAsync();
        if (existing === 'granted') {
          setStatus('microphone', 'done', 'Permission granted');
        } else {
          setStatus('microphone', 'running', 'Requesting permission...');
          const granted = await requestMic.mutateAsync();
          if (granted) setStatus('microphone', 'done', 'Permission granted');
          else {
            setStatus('microphone', 'failed', 'Permission denied. Grant it in System Settings.');
            setRunning(false);
            return;
          }
        }
      }

      if (snapshot.whisper !== 'done') {
        setStatus('whisper', 'running', 'Installing transcription engine...');
        await whisperStep.mutateAsync();
        setStatus('whisper', 'done', 'Transcription engine ready');
      }

      // Always re-run the summarization step on retry (the choice or key may
      // have changed). Reset its status from 'failed' so the chooser hides
      // while we run.
      setStatus('ollama', 'running', '');

      if (summaryMode === 'cloud') {
        setStatus('ollama', 'running', 'Saving cloud credentials...');
        // Persist provider preference + key, then verify with a small ping
        // call so the user gets immediate feedback if the key is bad.
        await setAiProvider.mutateAsync('cloud');
        await setCloudProviderMut.mutateAsync(cloudProvider);
        await setCloudKeyMut.mutateAsync(cloudApiKey.trim());
        setStatus('ollama', 'running', 'Testing connection...');
        // unwrap throws on { success: false } so reaching this line means the
        // provider responded successfully — no extra check needed.
        await testCloudApi.mutateAsync();
        setStatus('ollama', 'done', `Connected to ${cloudProvider}`);
      } else {
        // Make sure provider is local in case the user previously had cloud
        // configured and is re-running the wizard to switch back.
        await setAiProvider.mutateAsync('local');
        setStatus('ollama', 'running', 'Downloading model (~2 GB)...');
        await ollamaStep.mutateAsync();
        setStatus('ollama', 'done', 'Model installed');
      }

      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup step failed';
      setStatuses((prev) => {
        const failId = (Object.keys(prev) as Step['id'][]).find((k) => prev[k] === 'running');
        if (!failId) return prev;
        setDetails((d) => ({ ...d, [failId]: message }));
        return { ...prev, [failId]: 'failed' };
      });
    } finally {
      setRunning(false);
    }
  };

  const steps: Step[] = [
    {
      id: 'microphone',
      title: 'Microphone Access',
      description: 'Required for recording meetings',
      icon: Mic,
      status: statuses.microphone,
      detail: details.microphone,
    },
    {
      id: 'whisper',
      title: 'Transcription Engine',
      description: 'Converts speech to text locally',
      icon: MessageSquare,
      status: statuses.whisper,
      detail: details.whisper,
    },
    {
      id: 'ollama',
      title: 'Summarization Engine',
      description:
        summaryMode === 'cloud'
          ? 'Cloud API — fast, no download'
          : 'Local model (~2 GB) — private, runs on your Mac',
      icon: summaryMode === 'cloud' ? Cloud : Zap,
      status: statuses.ollama,
      detail: details.ollama,
    },
  ];

  // Show the Local/Cloud chooser before the third step has run AND after a
  // failure, so the user can correct a bad API key (or pick the other path
  // entirely) and retry without exiting the wizard. Hidden while running and
  // when the step has succeeded.
  const showSummaryChooser =
    !running && (statuses.ollama === 'waiting' || statuses.ollama === 'failed');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[560px] px-8 py-16">
        <div className="mb-8 text-center">
          <Display className="mb-3">Welcome to Steno</Display>
          <Lead>We'll help you set up everything needed for meeting intelligence.</Lead>
        </div>

        <div
          className="mb-6 flex items-center gap-4 rounded-md border border-border p-4"
          data-setup-name
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="setup-name-input" className="text-sm font-medium text-foreground">
              What should we call you?
            </label>
            <Muted className="mt-0.5">
              First name only — used for in-app greetings. Stored locally.
            </Muted>
          </div>
          <Input
            id="setup-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={persistName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                persistName();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Ruzin"
            autoComplete="given-name"
            className="w-[160px]"
          />
        </div>

        <div className="space-y-3" data-setup-steps>
          {steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>

        {showSummaryChooser && (
          <div
            className="mt-3 rounded-md border border-border p-4"
            data-setup-summary-chooser
          >
            <div className="mb-3 text-sm font-medium text-foreground">
              How should StenoAI summarize meetings?
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSummaryMode('local')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
                  summaryMode === 'local'
                    ? 'border-foreground bg-muted/40'
                    : 'border-border hover:bg-muted/20',
                )}
                aria-pressed={summaryMode === 'local'}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <HardDrive className="size-4" />
                    Local
                  </div>
                  {summaryMode === 'local' && <Check className="size-4 text-foreground" />}
                </div>
                <Muted className="text-[12px]">
                  Private. Free. ~2 GB download.
                </Muted>
              </button>
              <button
                type="button"
                onClick={() => setSummaryMode('cloud')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
                  summaryMode === 'cloud'
                    ? 'border-foreground bg-muted/40'
                    : 'border-border hover:bg-muted/20',
                )}
                aria-pressed={summaryMode === 'cloud'}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Cloud className="size-4" />
                    Cloud
                  </div>
                  {summaryMode === 'cloud' && <Check className="size-4 text-foreground" />}
                </div>
                <Muted className="text-[12px]">
                  Fast. Higher quality. Bring your own API key.
                </Muted>
              </button>
            </div>

            {summaryMode === 'cloud' && (
              <div className="mt-3 space-y-2">
                <div>
                  <label
                    className="mb-1 block text-[12px] font-medium text-foreground"
                    htmlFor="setup-cloud-provider"
                  >
                    Provider
                  </label>
                  <Select
                    value={cloudProvider}
                    onValueChange={(v) => setCloudProviderChoice(v as CloudProvider)}
                  >
                    <SelectTrigger id="setup-cloud-provider" className="h-8 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label
                    className="mb-1 block text-[12px] font-medium text-foreground"
                    htmlFor="setup-cloud-key"
                  >
                    API key
                  </label>
                  <Input
                    id="setup-cloud-key"
                    type="password"
                    value={cloudApiKey}
                    onChange={(e) => setCloudApiKey(e.target.value)}
                    placeholder={cloudProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Muted className="mt-1 text-[11px]">
                    Stored locally on this Mac. Never synced or sent anywhere
                    except the provider you select.
                  </Muted>
                </div>
              </div>
            )}
          </div>
        )}

        <div
          className="mt-3 flex items-start gap-4 rounded-md border border-border p-4"
          data-setup-telemetry
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              Anonymous usage analytics
            </div>
            <Muted className="mt-0.5">
              Help improve StenoAI — meeting content is never sent. You can
              change this any time in Settings → Advanced.
            </Muted>
          </div>
          <Switch
            checked={telemetryEnabled}
            onCheckedChange={(v) => setTelemetry.mutate(v)}
            disabled={telemetry.data === undefined}
            aria-label="Anonymous usage analytics"
          />
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          {done ? (
            <Button size="lg" onClick={() => navigate('/')}>
              Continue to app
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={runSetup}
              disabled={running || !canBegin}
              title={
                !canBegin
                  ? 'Enter your cloud API key first'
                  : undefined
              }
            >
              {running ? 'Setting up...' : 'Begin setup'}
            </Button>
          )}
          {!done && !running && !canBegin && (
            <Muted className="text-[12px]">
              Enter your API key to continue.
            </Muted>
          )}
        </div>

        <div className="mt-10 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setDebugOpen((o) => !o)}
            className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span>Debug console</span>
            <span>{debugOpen ? '−' : '+'}</span>
          </button>
          {debugOpen && (
            <pre className="mt-3 h-64 overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {logs.length === 0 ? 'StenoAI Setup\nCommands and output will appear here...\n' : logs.join('\n')}
            </pre>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-muted-foreground">
          <a
            href="https://github.com/ruzin/stenoai/issues"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Report an issue
          </a>
        </div>
      </div>
    </div>
  );
}

