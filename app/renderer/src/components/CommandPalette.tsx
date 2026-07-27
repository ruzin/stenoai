import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { meetingDisplayTitle } from '@/lib/meetingTitle';
import type { TFunction } from 'i18next';
import { Search } from 'lucide-react';
import { useMeetings, LIVE_SUMMARY_PREFIX } from '@/hooks/useMeetings';
import { searchNotes, snippet } from '@/lib/noteSearch';
import { navigate, useRoute } from '@/lib/router';
import { isMac } from '@/lib/utils';
import type { Meeting } from '@/lib/ipc';

interface PaletteContextValue {
  open: () => void;
}

const PaletteContext = React.createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  const ctx = React.useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  return ctx;
}

const RECENT_COUNT = 8;
// Bound how many matches we render/snippet per keystroke; a broad term against a
// large library would otherwise build hundreds of rows. Refine the query to reach
// the rest — standard command-palette behavior.
const MAX_RESULTS = 50;

/** Most-recent first. The backend list (useMeetings) is unsorted; Home re-sorts
 *  in groupPrevious by the same key, so we mirror it here. */
function recencyMs(m: Meeting): number {
  return new Date(m.session_info.processed_at ?? m.session_info.updated_at ?? 0).getTime();
}

interface SettingsEntry {
  id: string;
  /** A deep-link tab id accepted by Settings.tsx (its DEEP_LINK_IDS). Selecting
   *  a row navigates to `/settings?tab=<tab>`. Keep these in sync with the
   *  current nav rail (SettingsNav) — a stale id would land on the General tab. */
  tab: string;
  title: string;
  sub: string;
}

// Searchable index of the app's settings, mapped to the tab each one lives on
// today (post-v0.6.2 nav rail). Selecting a result opens that tab. Transcription
// settings now live on the AI tab, so they map to `ai`. Adapted from @Vassista's
// PR #349 and retargeted to the current tab layout.
//
// `key` names the `palette.settings.<key>` copy block (`.title` + `.sub`); `id`
// stays a stable, untranslated row identity. Keep the copy in sync with the
// rendered setting labels (GeneralTab/AiTab/AboutTab etc.) — the T1 spec asserts
// a few titles still match, to catch the index drifting out from under a
// renamed control.
const SETTINGS_ROWS: Array<{
  id: string;
  tab: string;
  key: string;
  /** Settings that only render on macOS (behind `isMac` in GeneralTab):
   *  "Record system audio" and "Hide dock icon". On Windows those rows don't
   *  exist, so indexing them would jump to a tab where nothing's there —
   *  filtered out below when not on mac (#405). */
  macOnly?: boolean;
}> = [
  { id: 'general-name', tab: 'general', key: 'name' },
  { id: 'general-theme', tab: 'general', key: 'theme' },
  { id: 'general-calendar', tab: 'general', key: 'calendar' },
  { id: 'general-scheduled', tab: 'general', key: 'scheduled' },
  { id: 'general-autodetect', tab: 'general', key: 'autoDetect' },
  { id: 'general-notifications', tab: 'general', key: 'notifications' },
  { id: 'general-mic', tab: 'general', key: 'microphone' },
  { id: 'general-system-audio', tab: 'general', key: 'systemAudio', macOnly: true },
  { id: 'general-silence', tab: 'general', key: 'silence' },
  { id: 'general-launch', tab: 'general', key: 'launch' },
  // Cross-platform row (Electron's Tray covers the macOS menu bar and the
  // Windows system tray); its rendered label switches on platform, so the
  // title key below does the same so it matches whatever GeneralTab shows.
  { id: 'general-menubar', tab: 'general', key: isMac ? 'menuBar' : 'systemTray' },
  { id: 'general-dock', tab: 'general', key: 'dockIcon', macOnly: true },
  { id: 'ai-language', tab: 'ai', key: 'language' },
  { id: 'ai-transcription', tab: 'ai', key: 'transcriptionModel' },
  { id: 'ai-save-recordings', tab: 'ai', key: 'saveRecordings' },
  { id: 'ai-autonotes', tab: 'ai', key: 'autoNotes' },
  { id: 'ai-provider', tab: 'ai', key: 'aiProvider' },
  { id: 'templates', tab: 'templates', key: 'templates' },
  { id: 'org', tab: 'organisation', key: 'organisation' },
  { id: 'advanced-storage', tab: 'advanced', key: 'storage' },
  { id: 'advanced-setup', tab: 'advanced', key: 'setupWizard' },
  { id: 'advanced-clear', tab: 'advanced', key: 'clearRecordingState' },
  { id: 'advanced-analytics', tab: 'advanced', key: 'analytics' },
  { id: 'developer', tab: 'developer', key: 'developer' },
  { id: 'about', tab: 'about', key: 'about' },
  { id: 'about-discord', tab: 'about', key: 'discord' },
];

// Only the settings that actually render on this platform. macOS-only rows
// ("Record system audio", "Hide dock icon") don't exist on Windows/Linux, so
// they're dropped from the index there — otherwise selecting one would jump to
// a tab where the row isn't shown (#405).
function buildSettingsIndex(t: TFunction): SettingsEntry[] {
  return SETTINGS_ROWS.filter((s) => !s.macOnly || isMac).map((s) => ({
    id: s.id,
    tab: s.tab,
    title: t(`palette.settings.${s.key}.title`),
    sub: t(`palette.settings.${s.key}.sub`),
  }));
}

/**
 * Global ⌘K search. Provides `open()` to descendants (the sidebar trigger) and
 * renders the overlay itself. Searches notes (title + summary) from any screen
 * via the shared matcher and opens the selected note. See #213.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open: () => setIsOpen(true) }), []);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      {isOpen && <CommandPalette onClose={() => setIsOpen(false)} />}
    </PaletteContext.Provider>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  // Context-aware: while the Settings page is open, ⌘K searches settings and
  // jumps to the tab each one lives on; everywhere else it searches notes.
  const currentRoute = useRoute();
  const isSettingsMode = currentRoute.startsWith('/settings');
  const meetings = useMeetings();
  // One recency sort feeds both paths: empty-query recents and search results
  // (searchNotes preserves input order, so results stay newest-first).
  const sorted = React.useMemo(
    () =>
      (meetings.data ?? [])
        // Drop the synthetic in-progress placeholders (live recording + the
        // processing row). They share the __live__/ sentinel summary_file, so
        // opening one would navigate to a detail route that doesn't exist on
        // disk. Real notes being reprocessed keep their real summary_file and
        // stay searchable.
        .filter((m) => !m.is_recording && !m.session_info.summary_file.startsWith(LIVE_SUMMARY_PREFIX))
        .slice()
        .sort((a, b) => recencyMs(b) - recencyMs(a)),
    [meetings.data],
  );
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  // Autofocus the input on open; restore focus to the previously-focused
  // element (e.g. the sidebar trigger) when the palette closes.
  React.useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const availableSettings = React.useMemo(() => buildSettingsIndex(t), [t]);

  const settingsResults = React.useMemo<SettingsEntry[]>(() => {
    if (!isSettingsMode) return [];
    if (!query.trim()) return availableSettings;
    const q = query.trim().toLowerCase();
    return availableSettings.filter(
      (s) => s.title.toLowerCase().includes(q) || s.sub.toLowerCase().includes(q),
    );
  }, [isSettingsMode, query, availableSettings]);

  const noteResults = React.useMemo<Meeting[]>(() => {
    if (isSettingsMode) return [];
    if (!query.trim()) return sorted.slice(0, RECENT_COUNT);
    return searchNotes(sorted, query).slice(0, MAX_RESULTS);
  }, [isSettingsMode, sorted, query]);

  const resultCount = isSettingsMode ? settingsResults.length : noteResults.length;

  // Keep selection within [0, len-1]; never let it stick at -1 once results
  // appear (ArrowDown on an empty list would otherwise leave it negative).
  React.useEffect(() => {
    setSelected((s) => Math.max(0, Math.min(s, resultCount - 1)));
  }, [resultCount]);

  // Scroll the active option into view as the keyboard selection moves.
  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openMeeting = (m: Meeting | undefined) => {
    if (!m) return;
    navigate(`/meetings/${encodeURIComponent(m.session_info.summary_file)}`);
    onClose();
  };

  const openSetting = (s: SettingsEntry | undefined) => {
    if (!s) return;
    navigate(`/settings?tab=${s.tab}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Stop the Escape from also reaching document-level handlers (e.g. the
      // QuitDialog's), which would otherwise close both at once.
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, resultCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isSettingsMode) openSetting(settingsResults[selected]);
      else openMeeting(noteResults[selected]);
    } else if (e.key === 'Tab') {
      // The input is the only tab stop in the dialog; trap Tab so focus can't
      // escape behind the aria-modal overlay.
      e.preventDefault();
    }
  };

  // Guard against `selected` briefly pointing past the list right after it
  // shrinks (before the clamp effect runs) — only expose activedescendant when
  // an option actually exists at that index, so aria never references a
  // nonexistent id.
  const activeId = (isSettingsMode ? settingsResults[selected] : noteResults[selected])
    ? `cmdk-opt-${selected}`
    : undefined;

  return (
    <div
      data-testid="command-palette"
      className="fixed inset-0 z-[200] flex items-start justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isSettingsMode ? t('palette.searchSettings') : t('palette.searchNotes')}
        className="relative mt-[12vh] w-[min(620px,92vw)] overflow-hidden rounded-xl shadow-[var(--shadow-md)]"
        style={{ background: 'var(--surface-raised)', border: '1px solid hsl(var(--border))' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div
          className="flex items-center gap-2 px-3.5 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Search className="size-[15px]" style={{ color: 'var(--fg-2)' }} />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
            placeholder={
              isSettingsMode ? t('palette.searchSettingsPlaceholder') : t('palette.searchNotesPlaceholder')
            }
            aria-label={isSettingsMode ? t('palette.searchSettings') : t('palette.searchNotes')}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-listbox"
            aria-activedescendant={activeId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
        </div>

        <ul
          ref={listRef}
          id="cmdk-listbox"
          role="listbox"
          aria-label={t('palette.results')}
          className="scrollbar-clean max-h-[50vh] overflow-auto py-1"
        >
          {resultCount === 0 ? (
            <li
              className="px-3.5 py-6 text-center text-[13px]"
              style={{ color: 'var(--fg-muted)' }}
            >
              {query.trim()
                ? isSettingsMode
                  ? t('palette.noSettingsMatch', { query: query.trim() })
                  : t('palette.noNotesMatch', { query: query.trim() })
                : isSettingsMode
                  ? t('palette.noSettings')
                  : t('palette.noNotes')}
            </li>
          ) : isSettingsMode ? (
            settingsResults.map((s, i) => (
              <li
                key={s.id}
                id={`cmdk-opt-${i}`}
                role="option"
                aria-selected={i === selected}
                data-index={i}
                data-testid="command-palette-result"
                className="mx-1 cursor-pointer rounded-md px-2.5 py-2"
                style={i === selected ? { background: 'var(--surface-active)' } : undefined}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  openSetting(s);
                }}
              >
                <div className="truncate text-[13.5px]" style={{ color: 'var(--fg-1)' }}>
                  {s.title}
                </div>
                <div className="truncate text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                  {s.sub}
                </div>
              </li>
            ))
          ) : (
            noteResults.map((m, i) => {
              const title =
                meetingDisplayTitle(m.session_info.name) || t('palette.untitledMeeting');
              const sub = snippet(m.summary, query);
              return (
                <li
                  key={m.session_info.summary_file}
                  id={`cmdk-opt-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  data-index={i}
                  data-testid="command-palette-result"
                  className="mx-1 cursor-pointer rounded-md px-2.5 py-2"
                  style={i === selected ? { background: 'var(--surface-active)' } : undefined}
                  onMouseEnter={() => setSelected(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openMeeting(m);
                  }}
                >
                  <div className="truncate text-[13.5px]" style={{ color: 'var(--fg-1)' }}>
                    {title}
                  </div>
                  {sub && (
                    <div className="truncate text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                      {sub}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <div
          className="flex items-center gap-3 px-3.5 py-2 text-[11px]"
          style={{
            color: 'var(--fg-muted)',
            borderTop: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span>{t('palette.hintNavigate')}</span>
          <span>{t('palette.hintOpen')}</span>
          <span>{t('palette.hintClose')}</span>
        </div>
      </div>
    </div>
  );
}
