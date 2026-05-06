// Templated preset prompts surfaced two ways:
//   1. Chip row at the bottom of the /chat entry page (always visible).
//   2. Popover triggered by typing '/' as the first character in either
//      composer (entry page or /chat/<id> conversation page).
// Edit the list here; both call sites pick it up automatically.
export interface ChatPreset {
  label: string;
  prompt: string;
  description: string;
}

export const PRESETS: ChatPreset[] = [
  {
    label: 'List recent todos',
    prompt: 'List my action items from the last week.',
    description: 'Pulls outstanding to-dos from recent meeting notes',
  },
  {
    label: 'Coach me',
    prompt: 'Coach me on my recent meetings — patterns, blind spots, things to work on.',
    description: 'Looks for patterns and suggests areas to improve',
  },
  {
    label: 'Write weekly recap',
    prompt: 'Write a recap of this week based on my notes.',
    description: 'Summary of the week across every meeting',
  },
  {
    label: 'Blind spots',
    prompt: 'What blind spots have come up across my recent meetings?',
    description: 'Surfaces themes you may have missed',
  },
];

/** Slash glyph used as the leading icon on every preset chip + popover
 *  row. Reinforces the "/" keyboard shortcut. Plain grey using the
 *  existing ink tokens so it sits quietly in the warm paper palette
 *  without claiming a colored accent. */
export function PresetGlyph() {
  return (
    <span
      aria-hidden
      className="inline-flex size-[18px] flex-shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-semibold leading-none"
      style={{
        color: 'var(--fg-2)',
        background: 'var(--surface-active)',
      }}
    >
      /
    </span>
  );
}
