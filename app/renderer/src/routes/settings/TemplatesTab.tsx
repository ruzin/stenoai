import * as React from 'react';
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Template } from '@/lib/ipc';
import {
  useDeleteTemplate,
  useResetTemplate,
  useSaveTemplate,
  useSetDefaultTemplate,
  useTemplates,
} from '@/hooks/useTemplates';
import { COMPACT_BTN, COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';
import { LANGUAGES_WHISPER, type LangOption } from './languages';

// ---------------------------------------------------------------------------
// Templates tab — manage summary report templates (CRUD + default pick).
// This is management UI only; it does not change how summaries are
// generated. The backend (Task 4) owns merging built-ins with user edits,
// so the renderer just lists what `templates.list()` returns and routes
// edits/resets/deletes back through the typed bridge.
// ---------------------------------------------------------------------------

// Template language picker. Built from LANGUAGES_WHISPER so the codes line
// up with Config.SUPPORTED_LANGUAGES (the 11 curated codes) plus 'auto',
// and we reuse its human labels rather than hardcoding a second list. A
// template's language pins the summary output language; 'auto' follows the
// transcript / global setting.
const TEMPLATE_LANGUAGES: LangOption[] = LANGUAGES_WHISPER;

export function TemplatesTab() {
  const { templates, defaultId, isLoading } = useTemplates();
  const setDefault = useSetDefaultTemplate();
  const reset = useResetTemplate();
  const del = useDeleteTemplate();

  // null = editor closed; a Template = edit existing; {} = new template.
  const [editing, setEditing] = React.useState<Partial<Template> | null>(null);
  // Template pending deletion → drives the confirmation dialog.
  const [deleteTarget, setDeleteTarget] = React.useState<Template | null>(null);

  return (
    <section data-settings-tab="templates">
      <SettingRow
        label="Default template"
        description="The template used for new summaries unless you pick another."
      >
        <Select
          value={defaultId}
          onValueChange={(v) => setDefault.mutate(v)}
          disabled={isLoading || templates.length === 0}
        >
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-64">
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SectionHeading>Templates</SectionHeading>

      {templates.map((t) => (
        <div
          key={t.id}
          className="mb-1.5 flex items-center gap-4 rounded-[8px] px-4 py-[13px]"
          style={{
            border: '1px solid var(--border-subtle)',
            background:
              t.id === defaultId ? 'var(--surface-raised)' : 'transparent',
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: 'var(--fg-1)' }}
              >
                {t.name}
              </span>
              {t.locked && (
                <span
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--fg-muted)' }}
                  title="Built-in template — protected from editing and deletion"
                >
                  <Lock size={11} aria-hidden="true" />
                  Locked
                </span>
              )}
              {t.builtin && !t.locked && (
                <span
                  className="rounded-[3px] px-1.5 py-px text-[11px]"
                  style={{
                    color: 'var(--fg-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Built-in
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {t.builtin ? (
              // A locked built-in (Standard) can't be edited, so there is no
              // override to reset and nothing to edit — show no actions (the
              // "Locked" badge above already conveys its state). Only an
              // editable built-in offers Reset + Edit.
              !t.locked && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={COMPACT_BTN}
                    disabled={reset.isPending}
                    onClick={() => reset.mutate(t.id)}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={COMPACT_BTN}
                    onClick={() => setEditing(t)}
                  >
                    Edit
                  </Button>
                </>
              )
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={COMPACT_BTN}
                  onClick={() => setEditing(t)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    COMPACT_BTN,
                    'text-[color:var(--fg-2)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger)]',
                  )}
                  onClick={() => setDeleteTarget(t)}
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      {editing ? (
        <TemplateEditor
          key={editing.id ?? 'new'}
          editing={editing.id ? editing : null}
          onClose={() => setEditing(null)}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={cn(COMPACT_BTN, 'mt-3')}
          onClick={() => setEditing({})}
        >
          <Plus size={14} className="mr-1.5" />
          New Template
        </Button>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Delete template "${deleteTarget.name}"?` : ''}
        description="This permanently deletes the template. Reports already generated from it are not affected."
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await del.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}

/** Inline editor for creating or editing a template. Surfaces backend
 *  validation/save errors inline rather than throwing — the save handler
 *  is the verbatim spec from the task brief. */
function TemplateEditor({
  editing,
  onClose,
}: {
  editing: Partial<Template> | null;
  onClose: () => void;
}) {
  const save = useSaveTemplate();
  const [name, setName] = React.useState(editing?.name ?? '');
  const [prompt, setPrompt] = React.useState(editing?.prompt ?? '');
  const [language, setLanguage] = React.useState(editing?.language ?? 'auto');
  const [error, setError] = React.useState<string | null>(null);

  const onSave = () => {
    setError(null);
    save.mutate(
      { id: editing?.id, name, prompt, language },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof Error ? e.message : 'Save failed'),
      },
    );
  };

  return (
    <div
      className="mt-3 rounded-[8px] p-4"
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-raised)',
      }}
    >
      <div
        className="mb-3 text-[13px] font-medium"
        style={{ color: 'var(--fg-1)' }}
      >
        {editing ? 'Edit template' : 'New template'}
      </div>

      <SettingRow label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly sync"
          className="h-[30px] w-[220px] text-[13px]"
        />
      </SettingRow>

      <SettingRow label="Language" description="Output language for the summary.">
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className={cn(COMPACT_TRIGGER, 'min-w-[180px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="pt-3">
        <div
          className="mb-2 text-[13px] font-medium"
          style={{ color: 'var(--fg-1)' }}
        >
          Prompt
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Summarise the meeting as…"
          rows={10}
          className="w-full min-h-[200px] text-[13px] leading-relaxed"
        />
      </div>

      {error && (
        <div
          className="mt-2 text-[12px]"
          style={{ color: 'var(--accent-danger, var(--fg-1))' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={COMPACT_BTN}
          onClick={onClose}
          disabled={save.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className={COMPACT_BTN}
          onClick={onSave}
          disabled={save.isPending || !name.trim()}
        >
          {save.isPending ? (
            <>
              <Loader2 className="mr-1.5 size-3 animate-spin" />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </div>
  );
}
