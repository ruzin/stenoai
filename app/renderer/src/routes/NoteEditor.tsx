import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UpdateMeetingPatch } from '@/lib/ipc';

/**
 * The editable shape of a generated (Standard) note, in the renderer's
 * camelCase vocabulary. Mapped to the snake_case `UpdateMeetingPatch` only at
 * the moment of saving, so the component never has to think in wire keys.
 */
export interface NoteDraft {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  discussionAreas: { title: string; analysis?: string }[];
}

interface NoteEditorProps {
  value: NoteDraft;
  /** Rejects on a failed write; the editor stays open and shows the reason. */
  onSave: (patch: UpdateMeetingPatch) => Promise<void>;
  onCancel: () => void;
}

/**
 * Mirrors `STRUCTURAL_LINE` in app/note-sections.js. A value that starts a line
 * with `#`..`######` would forge a section heading and re-partition the note on
 * the next parse, so main rejects it. Checking it here too turns a round-trip
 * failure into an inline message next to the field the user is looking at —
 * main stays the authority, this is only the faster answer.
 */
const STRUCTURAL_LINE = /^\s*#{1,6}\s/m;

/**
 * Single-line fields only. `renderBulletList` writes one `- ` line per entry
 * and the parsers keep only lines starting with `- `, so an embedded newline
 * silently drops everything after it on the next read. A newline in a topic
 * title doesn't lose text but moves the remainder into that topic's analysis,
 * and a lone `\r` makes the JS and Python parsers disagree about the title.
 * Both are drift, so both are refused before they reach disk.
 */
const LINE_BREAK = /[\r\n]/;

const HEADING_ERROR = "A note field can't contain a markdown heading.";
const LINE_BREAK_ERROR = "A key point, action item or topic title can't contain a line break.";

/**
 * Client-side mirror of the main-process gate. Returns the message to show, or
 * null when the patch is safe to send. Exported because the single-line inputs
 * make the line-break case unreachable through the UI (browsers and jsdom strip
 * CR/LF from `input[type=text]`) while it remains perfectly reachable from a
 * note that already has one on disk.
 */
export function validateNotePatch(patch: UpdateMeetingPatch): string | null {
  const everyField: string[] = [];
  const singleLineFields: string[] = [];

  if (typeof patch.summary === 'string') everyField.push(patch.summary);
  for (const entry of patch.key_points ?? []) {
    everyField.push(entry);
    singleLineFields.push(entry);
  }
  for (const entry of patch.action_items ?? []) {
    everyField.push(entry);
    singleLineFields.push(entry);
  }
  for (const area of patch.discussion_areas ?? []) {
    everyField.push(area.title);
    singleLineFields.push(area.title);
    if (typeof area.analysis === 'string') everyField.push(area.analysis);
  }

  if (everyField.some((field) => STRUCTURAL_LINE.test(field))) return HEADING_ERROR;
  if (singleLineFields.some((field) => LINE_BREAK.test(field))) return LINE_BREAK_ERROR;
  return null;
}

interface NormalizedDraft {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  discussionAreas: { title: string; analysis: string }[];
}

/**
 * The draft as it would land on disk: trimmed, with blank rows dropped (the
 * writers drop them anyway). Both sides of the dirty comparison run through
 * this, so an added-but-still-empty row, or a stray trailing space, is
 * correctly "no change" rather than a write that changes nothing.
 */
function normalize(draft: NoteDraft): NormalizedDraft {
  return {
    summary: draft.summary.trim(),
    keyPoints: draft.keyPoints.map((entry) => entry.trim()).filter(Boolean),
    actionItems: draft.actionItems.map((entry) => entry.trim()).filter(Boolean),
    discussionAreas: draft.discussionAreas
      .map((area) => ({ title: area.title.trim(), analysis: (area.analysis ?? '').trim() }))
      .filter((area) => area.title !== ''),
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

function sameAreas(a: NormalizedDraft['discussionAreas'], b: NormalizedDraft['discussionAreas']) {
  return (
    a.length === b.length &&
    a.every((area, i) => area.title === b[i].title && area.analysis === b[i].analysis)
  );
}

/** Only the sections that actually changed, in wire keys. */
function buildPatch(base: NormalizedDraft, next: NormalizedDraft): UpdateMeetingPatch {
  const patch: UpdateMeetingPatch = {};
  if (next.summary !== base.summary) patch.summary = next.summary;
  if (!sameList(next.keyPoints, base.keyPoints)) patch.key_points = next.keyPoints;
  if (!sameList(next.actionItems, base.actionItems)) patch.action_items = next.actionItems;
  if (!sameAreas(next.discussionAreas, base.discussionAreas)) {
    patch.discussion_areas = next.discussionAreas;
  }
  return patch;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || 'The note could not be saved.';
}

/**
 * The generated note, editable (decision D9). The read-only note is a document;
 * this is that same document with its sections opened up, reached through one
 * explicit "Edit" affordance and left again through Save or Cancel. Nothing is
 * written until Save, and a failed write keeps the editor — and the typing —
 * exactly where it was.
 */
export function NoteEditor({ value, onSave, onCancel }: NoteEditorProps) {
  // Snapshot both the working copy and the comparison baseline once, at open.
  // A background refetch of the meeting must not silently redefine "changed"
  // underneath an open editor, and the prop is never mutated.
  const [draft, setDraft] = React.useState<NoteDraft>(() => ({
    summary: value.summary,
    keyPoints: [...value.keyPoints],
    actionItems: [...value.actionItems],
    discussionAreas: value.discussionAreas.map((area) => ({ ...area })),
  }));
  const [baseline] = React.useState<NormalizedDraft>(() => normalize(value));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = React.useMemo(() => buildPatch(baseline, normalize(draft)), [baseline, draft]);
  const dirty = Object.keys(patch).length > 0;

  const ids = React.useId();
  const summaryId = `${ids}-summary`;

  const setList = (key: 'keyPoints' | 'actionItems', next: string[]) =>
    setDraft((prev) => ({ ...prev, [key]: next }));

  const handleSave = () => {
    if (!dirty || saving) return;
    const problem = validateNotePatch(patch);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(onSave(patch));
    } catch (thrown) {
      setSaving(false);
      setError(errorMessage(thrown));
      return;
    }
    void pending.then(
      () => {
        if (mounted.current) setSaving(false);
      },
      (rejection: unknown) => {
        if (!mounted.current) return;
        setSaving(false);
        setError(errorMessage(rejection));
      }
    );
  };

  return (
    <div className="flex flex-col gap-9" data-testid="note-editor">
      <div
        className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 px-2 py-2.5"
        style={{
          background: 'var(--surface-translucent)',
          backdropFilter: 'saturate(180%) blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span className="text-[13px]" style={{ color: 'var(--fg-2)' }}>
          Editing note
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="text-[13.5px] leading-[1.55]"
          style={{ color: 'var(--danger)', maxWidth: '64ch', marginTop: '-24px' }}
        >
          {error}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <FieldLabel htmlFor={summaryId}>Summary</FieldLabel>
        <GrowingTextarea
          id={summaryId}
          value={draft.summary}
          onChange={(next) => setDraft((prev) => ({ ...prev, summary: next }))}
          placeholder="Write the summary…"
          minHeight={110}
          fontSize={15.5}
        />
      </section>

      <section className="flex flex-col gap-3">
        <FieldLabel>Key topics</FieldLabel>
        <div className="flex flex-col gap-5">
          {draft.discussionAreas.map((area, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <RowInput
                  aria-label={`Topic ${i + 1} title`}
                  value={area.title}
                  onChange={(next) =>
                    setDraft((prev) => ({
                      ...prev,
                      discussionAreas: prev.discussionAreas.map((a, j) =>
                        j === i ? { ...a, title: next } : a
                      ),
                    }))
                  }
                  placeholder="Topic"
                  weight={600}
                />
                <RemoveButton
                  label={`Remove topic ${i + 1}`}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      discussionAreas: prev.discussionAreas.filter((_, j) => j !== i),
                    }))
                  }
                />
              </div>
              <GrowingTextarea
                aria-label={`Topic ${i + 1} notes`}
                value={area.analysis ?? ''}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    discussionAreas: prev.discussionAreas.map((a, j) =>
                      j === i ? { ...a, analysis: next } : a
                    ),
                  }))
                }
                placeholder="What was discussed…"
                minHeight={64}
                fontSize={14}
                className="mr-9"
              />
            </div>
          ))}
          <AddButton
            label="Add topic"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                discussionAreas: [...prev.discussionAreas, { title: '', analysis: '' }],
              }))
            }
          />
        </div>
      </section>

      <ListSection
        title="Key points"
        entryLabel="Key point"
        addLabel="Add key point"
        placeholder="A point worth remembering"
        entries={draft.keyPoints}
        onChange={(next) => setList('keyPoints', next)}
      />

      <ListSection
        title="Action items"
        entryLabel="Action item"
        addLabel="Add action item"
        placeholder="Who does what"
        entries={draft.actionItems}
        onChange={(next) => setList('actionItems', next)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Same type treatment as `SectionTitle` in the read-only note, so switching
 * into edit mode doesn't move or restyle a single section heading. Rendered as
 * a real <label> when it names one field, and as a plain heading for the lists
 * (whose rows carry their own labels).
 */
function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  const className = 'text-[13px] font-semibold tracking-[0.01em]';
  const style = { color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', margin: 0 } as const;
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={className} style={style}>
        {children}
      </label>
    );
  }
  return (
    <h2 className={className} style={style}>
      {children}
    </h2>
  );
}

const FIELD_CLASS =
  'w-full rounded-lg px-2.5 py-2 outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus-ring)]';

function fieldStyle(fontSize: number, weight = 400): React.CSSProperties {
  return {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--fg-1)',
    fontFamily: 'var(--font-sans)',
    fontSize,
    fontWeight: weight,
    lineHeight: 1.6,
  };
}

/** Single-line by construction — see LINE_BREAK above for why this is not a textarea. */
function RowInput({
  value,
  onChange,
  placeholder,
  weight,
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  weight?: number;
  'aria-label': string;
}) {
  return (
    <input
      {...rest}
      type="text"
      value={value}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      className={FIELD_CLASS}
      style={{ ...fieldStyle(14.5, weight), maxWidth: '64ch' }}
    />
  );
}

/** Grows to fit its content so a long summary is never a 3-line peephole. */
function GrowingTextarea({
  value,
  onChange,
  placeholder,
  minHeight,
  fontSize,
  className,
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeight: number;
  fontSize: number;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight is 0 under jsdom; the CSS minHeight keeps it sane there.
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minHeight]);

  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      placeholder={placeholder}
      spellCheck
      rows={2}
      onChange={(e) => onChange(e.target.value)}
      className={`${FIELD_CLASS} resize-none ${className ?? ''}`}
      style={{ ...fieldStyle(fontSize), minHeight, maxWidth: '64ch' }}
    />
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      style={{ color: 'var(--fg-2)' }}
    >
      <X className="size-[14px]" />
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
      style={{ color: 'var(--fg-2)' }}
    >
      <Plus className="size-[13px]" />
      {label}
    </button>
  );
}

function ListSection({
  title,
  entryLabel,
  addLabel,
  placeholder,
  entries,
  onChange,
}: {
  title: string;
  entryLabel: string;
  addLabel: string;
  placeholder: string;
  entries: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <FieldLabel>{title}</FieldLabel>
      <div className="flex flex-col gap-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <RowInput
              aria-label={`${entryLabel} ${i + 1}`}
              value={entry}
              placeholder={placeholder}
              onChange={(next) => onChange(entries.map((e, j) => (j === i ? next : e)))}
            />
            <RemoveButton
              label={`Remove ${entryLabel.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(entries.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <AddButton label={addLabel} onClick={() => onChange([...entries, ''])} />
      </div>
    </section>
  );
}
