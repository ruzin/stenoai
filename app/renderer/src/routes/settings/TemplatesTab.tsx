import * as React from 'react';
import { Loader2, Lock, Pin, Plus, Trash2 } from 'lucide-react';
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
import { COMPACT_BTN, SectionHeading } from './primitives';
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

export function TemplatesTab() {
  const { templates, defaultId } = useTemplates();
  const setDefault = useSetDefaultTemplate();
  const reset = useResetTemplate();
  const del = useDeleteTemplate();

  // null = editor closed; a Template = edit existing; {} = new template.
  const [editing, setEditing] = React.useState<Partial<Template> | null>(null);
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
      <div style={{ maxWidth: 600 }}>
        <SectionHeading>Templates</SectionHeading>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
        <button
          onClick={() => setEditing({})}
          className="flex flex-col items-center justify-center gap-2 rounded-[8px] p-4 text-[13px] font-medium transition-colors hover:bg-muted/50 text-center"
          style={{
            border: '1px dashed var(--border-subtle)',
            color: 'var(--fg-muted)',
            minHeight: '180px'
          }}
        >
          <Plus size={16} />
          <span className="font-semibold" style={{ color: 'var(--fg-1)' }}>New Template</span>
          <span className="text-[12px] max-w-[200px] leading-relaxed opacity-80 mt-1">
            Create custom prompts to tailor how your meetings are summarised.
          </span>
        </button>

        {[...templates].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)).map((t) => {
          const isDefault = t.id === defaultId;
          const hasActions = !isDefault || !t.builtin || !t.locked;

          return (
            <div
              key={t.id}
              className="flex flex-col rounded-[8px] transition-colors min-h-[180px]"
              style={{
                border: isDefault ? '1px solid var(--fg-1)' : '1px solid var(--border-subtle)',
                background:
                  isDefault ? 'var(--surface-raised)' : 'transparent',
              }}
            >
              <div className="flex flex-col gap-2 p-4 pb-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="truncate text-[13px] font-medium"
                    style={{ color: 'var(--fg-1)' }}
                  >
                    {t.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isDefault && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold"
                        style={{ color: 'var(--fg-1)' }}
                      >
                        <Pin size={10} aria-hidden="true" />
                        Default
                      </span>
                    )}
                    {t.locked && !isDefault && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider"
                        style={{ color: 'var(--fg-muted)' }}
                        title="Built-in template — protected from editing and deletion"
                      >
                        <Lock size={10} aria-hidden="true" />
                        Locked
                      </span>
                    )}
                    {t.builtin && !t.locked && !isDefault && (
                      <span
                        className="rounded-[3px] px-1.5 py-px text-[10px] uppercase tracking-wider"
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

                <div
                  className={cn(
                    "text-[12px] leading-relaxed line-clamp-5 mt-1",
                    !t.prompt && "italic"
                  )}
                  style={{ color: 'var(--fg-muted)', opacity: t.prompt ? 1 : 0.6 }}
                  title={t.prompt}
                >
                  {t.prompt || (t.builtin ? 'Uses structured format' : 'No prompt provided.')}
                </div>
              </div>

              {hasActions && (
                <div
                  className="flex shrink-0 items-center justify-end gap-2 px-4 py-3 border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(COMPACT_BTN, "mr-auto")}
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate(t.id)}
                    >
                      Make Default
                    </Button>
                  )}
                  {t.builtin ? (
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
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(t);
                        }}
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
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
        className="flex items-center justify-between mb-6 pb-4 border-b shrink-0"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div>
          <h2 className="text-[20px] font-medium" style={{ color: 'var(--fg-1)' }}>
            {editing?.id ? 'Edit template' : 'New template'}
          </h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--fg-muted)' }}>
            Configure how your meetings should be summarized
          </p>
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
            className="text-[14px] bg-transparent"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
            Language
          </label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="text-[14px] bg-transparent">
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
          background: 'var(--surface-sunken)'
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
          className="flex-1 w-full p-5 text-[14px] leading-relaxed border-0 focus-visible:ring-0 resize-none bg-transparent shadow-none"
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
