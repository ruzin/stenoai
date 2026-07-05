import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { useNavigate, getLastNonSettingsRoute, useRoute, getRouteParam } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useAppVersion } from '@/hooks/useSettings';
import { GeneralTab } from './settings/GeneralTab';
import { TranscriptionTab } from './settings/TranscriptionTab';
import { AiTab } from './settings/AiTab';
import { TemplatesTab } from './settings/TemplatesTab';
import { OrganisationTab } from './settings/OrganisationTab';
import { AdvancedTab } from './settings/AdvancedTab';
import { DeveloperTab } from './settings/DeveloperTab';

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

// ---------------------------------------------------------------------------
// Settings page — a thin shell that owns the tab state + chrome and renders
// one self-contained component per tab from ./settings/. Each tab drives its
// own hooks (there is no shared cross-tab state), so no context/prop-drilling
// is needed here.
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
          <div 
            className={cn(tab === 'templates' && 'h-full flex flex-col')}
            style={{ maxWidth: tab === 'templates' ? '100%' : 600, paddingTop: 8 }}
          >
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
