import * as React from 'react';
import { Check, Mic, MessageSquare, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Display, Lead, Muted } from '@/components/ui/typography';
import { useNavigate } from '@/lib/router';
import { useCheckMicPermission, useRequestMicPermission, useSetupStep } from '@/hooks/useSetup';
import { useSetTelemetry, useTelemetrySetting } from '@/hooks/useSettings';
import { ipc } from '@/lib/ipc';

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

  const setStatus = (id: Step['id'], s: StepStatus, detail?: string) => {
    setStatuses((prev) => ({ ...prev, [id]: s }));
    if (detail !== undefined) setDetails((prev) => ({ ...prev, [id]: detail }));
  };

  const runSetup = async () => {
    setRunning(true);
    setDone(false);
    try {
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

      setStatus('whisper', 'running', 'Installing transcription engine...');
      await whisperStep.mutateAsync();
      setStatus('whisper', 'done', 'Transcription engine ready');

      setStatus('ollama', 'running', 'Downloading model (~2 GB)...');
      await ollamaStep.mutateAsync();
      setStatus('ollama', 'done', 'Model installed');

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
      description: 'AI-powered meeting summaries (~2 GB)',
      icon: Zap,
      status: statuses.ollama,
      detail: details.ollama,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[560px] px-8 py-16">
        <div className="mb-8 text-center">
          <Display className="mb-3">Welcome to StenoAI</Display>
          <Lead>We'll help you set up everything needed for meeting intelligence.</Lead>
        </div>

        <div className="space-y-3" data-setup-steps>
          {steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>

        <div
          className="mt-6 flex items-start gap-4 rounded-md border border-border p-4"
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

        <div className="mt-8 flex justify-center gap-3">
          {done ? (
            <Button size="lg" onClick={() => navigate('/')}>
              Continue to app
            </Button>
          ) : (
            <Button size="lg" onClick={runSetup} disabled={running}>
              {running ? 'Setting up...' : 'Begin setup'}
            </Button>
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

