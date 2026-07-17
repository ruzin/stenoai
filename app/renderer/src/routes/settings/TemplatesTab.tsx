import * as React from 'react';
import { Check, ChevronLeft, Loader2, Lock, Plus, Trash2 } from 'lucide-react';
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
import { COMPACT_BTN } from './primitives';
import { LANGUAGES_WHISPER, type LangOption } from './languages';

// ---------------------------------------------------------------------------
// Templates tab — manage summary report templates (CRUD + default pick) as a
// card grid, plus a full-page editor. This is management UI only; it does
// not change how summaries are generated. The backend owns merging built-ins
// with user edits, so the renderer just lists what `templates.list()`
// returns and routes edits/resets/deletes/default-picks back through the
// typed bridge.
// ---------------------------------------------------------------------------

// Template language picker. Built from LANGUAGES_WHISPER so the codes line
// up with Config.SUPPORTED_LANGUAGES (the 11 curated codes) plus 'auto',
// and we reuse its human labels rather than hardcoding a second list. A
// template's language pins the summary output language; 'auto' follows the
// transcript / global setting.
const TEMPLATE_LANGUAGES: LangOption[] = LANGUAGES_WHISPER;

export function TemplatesTab({
  onEditingChange,
}: {
  // Lets Settings.tsx hide its own page header (title/description/divider)
  // while the editor is open — the editor is a full-page takeover with its
  // own header, so the outer "Templates" header would just carry over as a
  // redundant leftover from the list view above it.
  onEditingChange?: (editing: boolean) => void;
} = {}) {
  const { templates, defaultId } = useTemplates();
  const setDefault = useSetDefaultTemplate();
  const del = useDeleteTemplate();

  // null = editor closed; a Template = edit existing; {} = new template.
  const [editing, setEditing] = React.useState<Partial<Template> | null>(null);
  React.useEffect(() => {
    onEditingChange?.(!!editing);
  }, [editing, onEditingChange]);
  // Template pending deletion → drives the confirmation dialog.
  const [deleteTarget, setDeleteTarget] = React.useState<Template | null>(null);
  // Surfaced inside the confirm dialog when a delete fails, so a rejected
  // mutation isn't a silent unhandled rejection (#308). Cleared whenever the
  // dialog closes or a new delete starts.
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  if (editing) {
    return (
      <section data-settings-tab="templates" className="flex-1 h-full min-h-0 flex flex-col">
        <TemplateEditor
          key={editing.id ?? 'new'}
          editing={editing.id ? (editing as Template) : null}
          onClose={() => setEditing(null)}
        />
      </section>
    );
  }

  return (
    <section data-settings-tab="templates">
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-4 rounded-[8px] px-4 py-3 text-left transition-colors hover:bg-muted/50"
          style={{
            border: '1px dashed var(--border-subtle)',
            color: 'var(--fg-muted)',
          }}
        >
          <Plus size={16} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
              New Template
            </span>
            <div className="truncate text-[12px] mt-0.5">
              Create custom prompts to tailor how your meetings are summarised.
            </div>
          </div>
        </button>

        {/* Natural (backend) order, not default-first — marking a template
            default shouldn't reshuffle the list out from under the user. The
            "Default" badge below is what marks it, in place. */}
        {templates.map((t) => {
          const isDefault = t.id === defaultId;
          // Locked built-ins can't be made default or deleted — nothing to
          // reveal on hover, and (since clicking the row opens the editor)
          // nothing to click into either.
          const hasActions = !isDefault || !t.builtin;
          const isEditable = !t.builtin || !t.locked;

          return (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-4 rounded-[8px] px-4 py-3 transition-all duration-fast ease-steno",
                isEditable && "cursor-pointer hover:shadow-sm hover:border-[color:var(--fg-2)]",
                isEditable && !isDefault && "hover:bg-[color:var(--surface-hover)]",
              )}
              style={{
                border: isDefault ? '1px solid var(--fg-1)' : '1px solid var(--border-subtle)',
                background:
                  isDefault ? 'var(--surface-raised)' : 'transparent',
              }}
              role={isEditable ? 'button' : undefined}
              tabIndex={isEditable ? 0 : undefined}
              onClick={isEditable ? () => setEditing(t) : undefined}
              onKeyDown={
                isEditable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setEditing(t);
                      }
                    }
                  : undefined
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="truncate text-[13px] font-medium"
                    style={{ color: 'var(--fg-1)' }}
                  >
                    {t.name}
                  </span>
                  {isDefault && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wider font-semibold"
                      style={{ color: 'var(--fg-1)' }}
                      title="Used automatically for new meetings unless you pick a different one"
                    >
                      <Check size={10} aria-hidden="true" />
                      Default
                    </span>
                  )}
                  {t.locked && !isDefault && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wider"
                      style={{ color: 'var(--fg-muted)' }}
                      title="Built-in template — protected from editing and deletion"
                    >
                      <Lock size={10} aria-hidden="true" />
                      Locked
                    </span>
                  )}
                  {t.builtin && !t.locked && !isDefault && (
                    <span
                      className="shrink-0 rounded-[3px] px-1.5 py-px text-[10px] uppercase tracking-wider"
                      style={{
                        color: 'var(--fg-muted)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      Built-in
                    </span>
                  )}
                </div>

                <div
                  className={cn(
                    "line-clamp-2 text-[12px] leading-relaxed mt-0.5 cursor-[inherit]",
                    !t.prompt && "italic",
                  )}
                  style={{ color: 'var(--fg-muted)', opacity: t.prompt ? 1 : 0.6 }}
                  title={t.prompt}
                >
                  {t.prompt || (t.builtin ? 'Uses structured format' : 'No prompt provided.')}
                </div>
              </div>

              {hasActions && (
                // Hidden until the row is hovered/focused — the row itself
                // is the click target for editing, so these are just the
                // secondary actions (make default / delete).
                <div
                  className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-fast ease-steno group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={COMPACT_BTN}
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate(t.id)}
                    >
                      Make Default
                    </Button>
                  )}
                  {!t.builtin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        COMPACT_BTN,
                        'text-[color:var(--fg-2)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger)]',
                      )}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(t);
                      }}
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={deleteTarget ? `Delete template "${deleteTarget.name}"?` : ''}
        description={
          <>
            This permanently deletes the template. Reports already generated
            from it are not affected.
            {deleteError && (
              <span
                role="alert"
                style={{
                  display: 'block',
                  marginTop: 8,
                  color: 'var(--accent-danger)',
                }}
              >
                {deleteError}
              </span>
            )}
          </>
        }
        confirmLabel="Delete"
        destructive
        isPending={del.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError(null);
          try {
            await del.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          } catch (e) {
            // Keep the dialog open so the user can retry; surface why.
            setDeleteError(
              e instanceof Error ? e.message : 'Failed to delete template.',
            );
          }
        }}
      />
    </section>
  );
}

/** Full-page editor for creating or editing a template. Surfaces backend
 *  validation/save errors inline rather than throwing. */
function TemplateEditor({
  editing,
  onClose,
}: {
  editing: Partial<Template> | null;
  onClose: () => void;
}) {
  const save = useSaveTemplate();
  const reset = useResetTemplate();
  const { defaultId } = useTemplates();
  const setDefault = useSetDefaultTemplate();
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
    <div className="flex flex-col h-full flex-1 pt-2 animate-in fade-in zoom-in-95 duration-200">
      {/* Header Area */}
      <div
        className="flex items-center justify-between gap-3 mb-6 pb-4 border-b shrink-0"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            aria-label="Back to templates"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)] disabled:pointer-events-none disabled:opacity-50"
            style={{ color: 'var(--fg-2)' }}
          >
            <ChevronLeft className="size-[18px]" />
          </button>
          <div>
            <h2 className="text-[20px] font-medium" style={{ color: 'var(--fg-1)' }}>
              {editing?.id ? 'Edit template' : 'New template'}
            </h2>
            <p className="text-[13px] mt-1" style={{ color: 'var(--fg-muted)' }}>
              Configure how your meetings should be summarized
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editing?.id && editing.id !== defaultId && (
            <Button
              variant="outline"
              size="sm"
              className={COMPACT_BTN}
              disabled={setDefault.isPending}
              onClick={() => {
                if (editing.id) setDefault.mutate(editing.id);
              }}
            >
              Make Default
            </Button>
          )}
          {editing?.id && editing.builtin && !editing.locked && (
            <Button
              variant="ghost"
              size="sm"
              className={COMPACT_BTN}
              disabled={reset.isPending}
              title="Discard your edits and revert to Steno's shipped version of this template"
              onClick={() => {
                if (editing.id) reset.mutate(editing.id, { onSuccess: () => onClose() });
              }}
            >
              Reset
            </Button>
          )}
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
              'Save Template'
            )}
          </Button>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 shrink-0">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly Sync, Executive Summary..."
            className="text-[14px] bg-[color:var(--surface-raised)]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
            Language
          </label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="text-[14px] bg-[color:var(--surface-raised)]">
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
        </div>
      </div>

      {/* Prompt Area */}
      <div
        className="flex flex-col flex-1 min-h-0 rounded-[8px] overflow-hidden"
        style={{
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)'
        }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between border-b shrink-0"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--surface-raised)'
          }}
        >
          <span className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
            System Prompt
          </span>
          <span className="text-[12px]" style={{ color: 'var(--fg-muted)' }}>
            Markdown supported
          </span>
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Write a prompt instructing the AI how to structure the meeting summary..."
          className="flex-1 w-full p-5 text-[14px] leading-relaxed border-0 focus-visible:ring-0 resize-none bg-[color:var(--surface-raised)] shadow-none"
          style={{ color: 'var(--fg-1)' }}
        />
      </div>

      {error && (
        <div
          className="mt-4 p-3 rounded-[8px] text-[13px] flex items-center shrink-0"
          style={{
            color: 'var(--accent-danger)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--accent-danger)'
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}
