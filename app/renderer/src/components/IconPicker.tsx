import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as LucideIcons from 'lucide-react';
import { Search, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Icon catalogue — name (kebab-case lucide icon) + searchable tags
// ---------------------------------------------------------------------------

const ICON_LIST = [
  // Work & org
  { name: 'briefcase',      tags: ['work','job','office','bag'] },
  { name: 'building-2',     tags: ['office','company','building','org'] },
  { name: 'users',          tags: ['team','people','group'] },
  { name: 'user',           tags: ['person','profile','account'] },
  { name: 'user-check',     tags: ['person','verified','profile'] },
  { name: 'presentation',   tags: ['slides','talk','pitch'] },
  { name: 'chart-bar',      tags: ['stats','data','analytics','graph'] },
  { name: 'chart-line',     tags: ['trend','graph','analytics'] },
  { name: 'chart-pie',      tags: ['breakdown','analytics','chart'] },
  { name: 'target',         tags: ['goal','aim','objective'] },
  { name: 'trophy',         tags: ['win','award','achievement'] },
  { name: 'handshake',      tags: ['deal','partner','agreement'] },
  { name: 'calendar',       tags: ['date','schedule','event'] },
  { name: 'calendar-days',  tags: ['date','schedule','meeting'] },
  { name: 'clock',          tags: ['time','schedule','timer'] },
  { name: 'mail',           tags: ['email','message','inbox'] },
  { name: 'inbox',          tags: ['email','messages','all'] },
  { name: 'send',           tags: ['email','message','send'] },
  { name: 'phone',          tags: ['call','contact','mobile'] },
  { name: 'video',          tags: ['meeting','call','zoom'] },
  { name: 'laptop',         tags: ['computer','work','device'] },
  { name: 'monitor',        tags: ['desktop','screen','computer'] },
  { name: 'pen-line',       tags: ['write','edit','notes'] },
  { name: 'pencil',         tags: ['write','edit','notes'] },
  { name: 'clipboard',      tags: ['notes','list','task'] },
  { name: 'clipboard-list', tags: ['tasks','checklist','todo'] },
  { name: 'list-checks',    tags: ['done','checklist','todo'] },
  { name: 'check-square',   tags: ['done','complete','task'] },
  { name: 'file-text',      tags: ['document','notes','file'] },
  { name: 'file',           tags: ['document','file','generic'] },
  { name: 'files',          tags: ['documents','multiple','files'] },
  { name: 'folder',         tags: ['folder','directory','files'] },
  { name: 'folder-open',    tags: ['folder','open','files'] },
  { name: 'archive',        tags: ['store','archive','box'] },
  { name: 'box',            tags: ['storage','package','box'] },
  { name: 'package',        tags: ['delivery','product','box'] },
  { name: 'bookmark',       tags: ['save','mark','favourite'] },
  { name: 'tag',            tags: ['label','category','tag'] },
  { name: 'tags',           tags: ['labels','categories','tags'] },
  { name: 'layers',         tags: ['stack','categories','layers'] },
  { name: 'flag',           tags: ['priority','flag','mark'] },
  { name: 'link',           tags: ['url','link','connect'] },
  { name: 'search',         tags: ['find','search','magnify'] },
  { name: 'filter',         tags: ['sort','filter','refine'] },
  // Health & medical
  { name: 'stethoscope',    tags: ['health','medical','doctor','clinic'] },
  { name: 'heart-pulse',    tags: ['health','medical','heart','vital'] },
  { name: 'heart',          tags: ['health','favourite','love','care'] },
  { name: 'activity',       tags: ['health','pulse','monitor','vital'] },
  { name: 'pill',           tags: ['medicine','pharmacy','drug'] },
  { name: 'hospital',       tags: ['health','building','medical'] },
  { name: 'thermometer',    tags: ['health','temperature','medical'] },
  { name: 'eye',            tags: ['vision','view','health'] },
  { name: 'brain',          tags: ['mind','neuro','health','thinking'] },
  { name: 'microscope',     tags: ['science','lab','research','health'] },
  // Legal & finance
  { name: 'scale',          tags: ['legal','law','justice','balance'] },
  { name: 'gavel',          tags: ['legal','court','ruling','law'] },
  { name: 'scroll',         tags: ['legal','document','contract'] },
  { name: 'shield',         tags: ['protection','security','privacy','legal'] },
  { name: 'shield-check',   tags: ['safe','verified','security','legal'] },
  { name: 'lock',           tags: ['private','secure','lock'] },
  { name: 'key',            tags: ['access','key','unlock','security'] },
  { name: 'landmark',       tags: ['bank','government','institution'] },
  { name: 'banknote',       tags: ['money','finance','payment','cash'] },
  { name: 'coins',          tags: ['money','finance','currency'] },
  { name: 'wallet',         tags: ['payment','money','finance'] },
  { name: 'credit-card',    tags: ['payment','finance','card'] },
  { name: 'trending-up',    tags: ['growth','finance','increase'] },
  { name: 'trending-down',  tags: ['decline','finance','decrease'] },
  // Property & home
  { name: 'home',           tags: ['house','property','home','real estate'] },
  { name: 'map-pin',        tags: ['location','place','address','property'] },
  { name: 'map',            tags: ['location','navigation','area'] },
  { name: 'compass',        tags: ['navigate','direction','explore'] },
  { name: 'door-open',      tags: ['entry','access','property','door'] },
  { name: 'sofa',           tags: ['interior','home','living','furniture'] },
  { name: 'bed',            tags: ['bedroom','property','sleep'] },
  // Education & research
  { name: 'graduation-cap', tags: ['education','study','university','degree'] },
  { name: 'book',           tags: ['read','study','learn','book'] },
  { name: 'book-open',      tags: ['read','study','content','open'] },
  { name: 'library',        tags: ['books','research','archive','library'] },
  { name: 'lightbulb',      tags: ['idea','inspiration','creative'] },
  { name: 'flask-conical',  tags: ['science','research','lab','experiment'] },
  { name: 'test-tube',      tags: ['science','lab','chemistry','test'] },
  { name: 'telescope',      tags: ['research','discovery','explore'] },
  // Tech & dev
  { name: 'code-2',         tags: ['code','developer','programming','tech'] },
  { name: 'terminal',       tags: ['code','shell','dev','console'] },
  { name: 'git-branch',     tags: ['code','version control','dev','git'] },
  { name: 'database',       tags: ['data','storage','tech','db'] },
  { name: 'server',         tags: ['infrastructure','tech','cloud','server'] },
  { name: 'cloud',          tags: ['cloud','storage','tech','backup'] },
  { name: 'cpu',            tags: ['hardware','tech','compute','processor'] },
  { name: 'wifi',           tags: ['network','internet','connection'] },
  { name: 'settings',       tags: ['config','preferences','settings'] },
  { name: 'wrench',         tags: ['tool','fix','maintenance','dev'] },
  { name: 'bug',            tags: ['error','debug','issue','dev'] },
  { name: 'zap',            tags: ['fast','power','lightning','automation'] },
  { name: 'rocket',         tags: ['launch','startup','fast','deploy'] },
  // Creative & media
  { name: 'mic',            tags: ['audio','record','voice','meeting'] },
  { name: 'headphones',     tags: ['audio','listen','music','media'] },
  { name: 'music',          tags: ['audio','song','playlist','media'] },
  { name: 'camera',         tags: ['photo','image','capture','media'] },
  { name: 'image',          tags: ['photo','picture','gallery','media'] },
  { name: 'film',           tags: ['video','movie','media','film'] },
  { name: 'play-circle',    tags: ['video','play','media','watch'] },
  { name: 'pen-tool',       tags: ['design','draw','creative','pen'] },
  { name: 'palette',        tags: ['design','colour','creative','art'] },
  { name: 'layout-grid',    tags: ['design','grid','layout','ui'] },
  { name: 'sparkles',       tags: ['ai','magic','new','creative','feature'] },
  // Nature & misc
  { name: 'sun',            tags: ['morning','bright','day','energy'] },
  { name: 'moon',           tags: ['night','dark','evening','rest'] },
  { name: 'star',           tags: ['favourite','important','rate','star'] },
  { name: 'globe',          tags: ['world','international','web','global'] },
  { name: 'leaf',           tags: ['nature','green','environment','eco'] },
  { name: 'tree-pine',      tags: ['nature','forest','environment'] },
  { name: 'mountain',       tags: ['landscape','outdoors','nature'] },
  { name: 'flame',          tags: ['hot','urgent','fire','energy'] },
  { name: 'coffee',         tags: ['break','morning','casual','relax'] },
  { name: 'smile',          tags: ['happy','personal','casual','mood'] },
];

// Deduplicate by name
const ICONS = Array.from(new Map(ICON_LIST.map((i) => [i.name, i])).values());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case to PascalCase for lucide-react named exports. */
function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Render a lucide icon by its kebab-case name. Falls back to Folder icon. */
export function LucideIcon({
  name,
  size = 16,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const pascal = toPascalCase(name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const icons = LucideIcons as Record<string, any>;
  const Comp = icons[pascal] ?? icons['Folder'];
  return <Comp size={size} strokeWidth={1.5} className={className} style={style} />;
}

// ---------------------------------------------------------------------------
// IconPicker
// ---------------------------------------------------------------------------

const PANEL_W = 276;
const PANEL_MAX_H = 320;
const SEARCH_H = 52;
const GAP = 6;

interface IconPickerProps {
  anchorRect: DOMRect;
  onSelect: (iconName: string) => void;
  onClose: () => void;
}

export function IconPicker({ anchorRect, onSelect, onClose }: IconPickerProps) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter(
      (i) => i.name.includes(q) || i.tags.some((t) => t.includes(q)),
    );
  }, [query]);

  // Focus search on mount
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click-outside to close (slight delay so the originating click doesn't immediately close)
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Escape to close
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Position: below anchor, horizontally centred; flip above if not enough space
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchorRect.left + anchorRect.width / 2 - PANEL_W / 2;
  let top = anchorRect.bottom + GAP;

  if (left < 8) left = 8;
  if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
  if (top + PANEL_MAX_H > vh - 8) top = Math.max(8, anchorRect.top - PANEL_MAX_H - GAP);

  const portal = document.getElementById('dialog-host') ?? document.body;

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top,
        left,
        width: PANEL_W,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-md, 0 8px 32px rgba(0,0,0,0.12))',
        zIndex: 9999,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Search bar */}
      <div
        style={{
          padding: '10px 10px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'var(--surface-hover)',
            borderRadius: 7,
            padding: '5px 9px',
          }}
        >
          <Search size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--fg-2)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: 'var(--fg-1)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--fg-2)',
                display: 'flex',
              }}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Icon grid */}
      <div
        className="scrollbar-clean"
        style={{ overflowY: 'auto', maxHeight: PANEL_MAX_H - SEARCH_H, padding: '6px 8px 8px' }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
            }}
          >
            No icons match "{query}"
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 2,
              padding: '2px 0',
            }}
          >
            {filtered.map((icon) => (
              <IconButton
                key={icon.name}
                name={icon.name}
                onSelect={() => { onSelect(icon.name); onClose(); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    portal,
  );
}

function IconButton({ name, onSelect }: { name: string; onSelect: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      title={name.replace(/-/g, ' ')}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        color: hovered ? 'var(--fg-1)' : 'var(--fg-2)',
        transition: 'background 120ms, color 120ms',
      }}
    >
      <LucideIcon name={name} size={16} />
    </button>
  );
}
