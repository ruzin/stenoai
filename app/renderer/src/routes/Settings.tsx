import * as React from 'react';
import { useRoute, getRouteParam } from '@/lib/router';
import { MeetingsShell } from '@/components/MeetingsShell';
import { cn } from '@/lib/utils';
import { useAppVersion } from '@/hooks/useSettings';
import { GeneralTab } from './settings/GeneralTab';
import { TranscriptionTab } from './settings/TranscriptionTab';
import { AiTab } from './settings/AiTab';
import { TemplatesTab } from './settings/TemplatesTab';
import { OrganisationTab } from './settings/OrganisationTab';
import { AdvancedTab } from './settings/AdvancedTab';
import { DeveloperTab } from './settings/DeveloperTab';

import {
  Settings as SettingsIcon,
  Mic,
  Sparkles,
  LayoutTemplate,
  Building2,
  Sliders,
  TerminalSquare
} from 'lucide-react';

export const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'transcription', label: 'Transcribe', icon: Mic },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'organisation', label: 'Organisation', icon: Building2 },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
  { id: 'developer', label: 'Developer', icon: TerminalSquare },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

// ---------------------------------------------------------------------------
// Settings page — a thin shell that renders one self-contained component per 
// tab from ./settings/. Each tab drives its own hooks (there is no shared 
// cross-tab state), so no context/prop-drilling is needed here.
// ---------------------------------------------------------------------------

export function Settings() {
  const route = useRoute();
  
  const tab = React.useMemo<SettingsTabId>(() => {
    const requested = getRouteParam(route, 'tab');
    if (requested && SETTINGS_TABS.some((t) => t.id === requested)) {
      return requested as SettingsTabId;
    }
    return 'general';
  }, [route]);
  
  const version = useAppVersion();

  return (
    <MeetingsShell activeSummaryFile={null} bleed>
      <div
        data-testid="settings-page"
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--page)' }}
      >

        <div
          className="scrollbar-clean min-h-0 flex-1 overflow-y-auto"
          style={{ padding: '8px 48px 64px' }}
        >
          <div 
            className={cn(tab === 'templates' && 'h-full flex flex-col', 'mx-auto')}
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
