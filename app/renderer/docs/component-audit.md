# Component Audit — Legacy → Steno

**Purpose:** Every UI pattern in `app/index.html` (10.6k lines, 285 unique CSS
selectors, 409 class-attr occurrences) gets mapped to a consolidated React
component — or justified as inline. This audit is the gate that stops the new
`app/renderer/src/components/` tree from growing past ~15 files.

**Counting methodology**
- **Defined**: selector appears in the inline `<style>` block of `index.html`
  (count = number of CSS rules / modifiers for that class).
- **Used**: distinct element in static markup OR distinct classList touch in
  inline JS. The CSS count is the practical "how many variants" signal; the
  usage count is "how many calls sites will migrate".

**Rule:** If a pattern has fewer than 3 real usages, it stays inline —
no component. "New component (justify)" column explains any primitive not
already in shadcn-new-york.

**Target:** ≤ 15 files in `app/renderer/src/components/` at end of Phase 2.

---

## 1. Buttons — one `<Button>` with variants + sizes

Consolidated: `<Button variant='…' size='…' iconOnly? destructive?>`.
Replaces 30+ legacy button classes.

| Legacy pattern | Legacy selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Primary record action | `.btn.btn-primary` | 1 | `<Button variant="default">` | |
| Stop-recording action | `.btn.btn-danger` | 1 | `<Button variant="destructive">` | |
| Secondary / cancel | `.btn.btn-secondary` | ~4 | `<Button variant="secondary">` | |
| Setup flow download | `.btn-download` | 2 | `<Button variant="default">` | |
| Setup retry | `.btn-retry` | 2 | `<Button variant="secondary">` | |
| Bare button (ghost) | `.btn` (no modifier) | 3 | `<Button variant="ghost">` | |
| Settings-row action ("Check", "Test", "Refresh") | `.settings-action-btn` | 15 | `<Button variant="outline" size="sm">` | |
| Settings gear launcher | `.settings-btn` | 1 | `<Button variant="ghost" size="icon">` | |
| Announcement banner CTA | `.announcement-btn` | 1 | `<Button variant="outline" size="sm">` | |
| Dismiss announcement (×) | `.dismiss-announcement` | 1 | `<Button variant="ghost" size="icon">` | |
| New note | `.new-note-btn` | 1 | `<Button variant="default">` | Accent color — already covered by default variant. |
| Reprocess meeting | `.reprocess-btn` | 1 | `<Button variant="ghost" size="icon">` | Spinner state inline. |
| Folder add | `.folder-add-btn` | 1 | `<Button variant="ghost" size="icon">` | |
| Copy (log / transcript / notes) | `.copy-log-btn`, `.copy-transcript-btn`, `.copy-notes-btn` | 3 | `<Button variant="ghost" size="sm">` with `.copied` state | Share copy-success animation via `copied` prop or sibling toast — do NOT add per-button variant. |
| Edit / save / cancel title | `.edit-title-btn`, `.save-title-btn`, `.cancel-title-btn` | 3 | `<Button variant="ghost" size="icon">` (edit) + `<Button size="sm">` (save/cancel) | |
| Ask-AI launcher | `.ask-ai-btn` | 1 | `<Button variant="ghost" size="sm">` | |
| Calendar refresh / record | `.calendar-refresh-btn`, `.calendar-record-btn` | 2 | `<Button variant="ghost" size="icon">` + `<Button variant="default">` | |
| Calendar back | `.calendar-detail-back` | 1 | `<Button variant="ghost" size="icon">` | |
| Sidebar toggle | `.sidebar-toggle` | 1 | `<Button variant="ghost" size="icon">` | |
| Home (brand) | `.brand.home-btn` | 1 | Inline — it's a logo, not a button. Keep as `<button>` with styling. |
| Dev back | `.dev-back-btn` | 1 | `<Button variant="ghost" size="sm">` | |
| Ask-bar submit / stop | `.ask-bar-submit`, `.ask-bar-stop` | 2 | `<Button size="icon" variant="default">` + `destructive` equivalent | |
| Ask-bar new-chat | `.ask-bar-new-chat-btn` | 1 | `<Button variant="ghost" size="sm">` | |
| Ask-bar history | `.ask-bar-history-btn` | 1 | `<Button variant="ghost" size="icon">` | |
| Ask-bar chat title toggle | `.ask-bar-chat-title-btn` | 1 | `<Button variant="ghost">` + chevron | |
| AI query popup submit/close | `.ai-query-submit`, `.ai-query-close` | 2 | `<Button size="icon">` + `<Button variant="ghost" size="icon">` | |
| Bar stop (mini player) | `.bar-stop-btn` | 1 | `<Button variant="destructive" size="icon">` | |

**Variants the consolidated Button must gain (vs. stock shadcn):**
- None. Stock `default / destructive / outline / secondary / ghost / link`
  plus `default / sm / lg / icon` sizes covers every legacy case above.
- `copied` success-flash state: use a transient className prop on the caller,
  don't bake into Button.

---

## 2. Inputs — one `<Input>`, one `<Textarea>`, one `<Select>`

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Session name entry | `.session-input` | 1 | `<Input size="lg">` | |
| Settings text field | `.settings-input` | 4 | `<Input>` | |
| Search | `.search-input` | 1 | `<Input>` + icon slot | Sidebar search. Covered by base input. |
| Ask-bar prompt | `.ask-bar-input` | 1 | `<Textarea autoResize>` | Auto-resize is one line of CSS — add to base `<Textarea>`. |
| Meeting title inline edit | `.meeting-title-input` | 1 | `<Input>` inheriting parent font | Style variant: `variant="inherit-typography"`. |
| Theme selector | `.theme-select` | 3 | `<Select>` (Radix) | shadcn select. |
| Provider config field | `.provider-config-field` | 3 | `<Input>` or `<Select>` | Labelled row pattern — uses settings-row, not a new component. |

**Variants needed:** `<Input size="lg">` for the big session-name entry; a
`variant="inherit-typography"` toggle so the inline title editor keeps the
h1 look. Both minor.

---

## 3. Toggles & checkboxes — `<Switch>` + `<Checkbox>`

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Settings pill toggle | `.settings-toggle` / `.toggle-slider` | 6 | `<Switch>` | Radix switch. |

No checkbox uses detected — drop `<Checkbox>` unless a later ticket needs it.

---

## 4. Badges / chips / pills — one `<Badge>` + inline patterns

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Update-available badge | `.update-badge` | 1 | `<Badge variant="default">` | |
| Setup-step status badge | `.step-badge` (+ `.waiting`, `.active`, `.completed`, `.failed`) | 7 | `<Badge variant="outline\|default\|destructive\|secondary">` | 4 states → 4 variants, all already in shadcn Badge. |
| Folder pill (membership chip) | `.folder-pill` | 1 | Inline — it's a rounded rect with a folder icon. Use `<Badge>` + `iconStart` prop. |
| Folder pill dropdown item | `.folder-pill-dropdown-item` | 2 | Part of `<FolderPicker>` (see §8). |
| Ask-bar starter-prompt chip | `.ask-bar-prompt-chip` | 3 | `<Badge variant="outline" interactive>` | Add `interactive` (hover) state. |
| Model-tag ("Installed", "Active", "Deprecated") | `.model-tag` | 2 | `<Badge>` (variants) | |
| Meeting-dot (unread marker) | `.meeting-dot` | 2 | Inline `<span>` — 1 tailwind rule, no component. |
| Shortcut-hint ("⌘⇧R") | `.shortcut-hint` | 1 | Inline `<kbd>` — styled in globals.css. |
| Update / release type | `.type-info`, `.type-warning`, `.type-release` | 3 | `<Badge>` variants | |
| Privacy ghost (local/remote/cloud) | `.privacy-ghost` + `.local`, `.remote`, `.cloud` | 11 CSS rules across states | Inline `<PrivacyBadge>` — custom component: SVG ghost + tri-state. **New component (justify): too much visual personality (animated eyes + connection bars) to hide in a generic Badge.** |

**Consolidated count in this section:** `<Badge>` (1) + `<PrivacyBadge>` (1).

---

## 5. Cards / rows — layout primitives, not components

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Meeting row in sidebar | `.meeting-item` | 21 | `<MeetingRow>` | Click target, active state, dot marker, drag source. Real component. |
| Folder row | `.folder-item` | 8 | `<FolderRow>` | Click target, active state, count, drag target, menu. Real component. |
| Calendar event row | `.calendar-sidebar-item` | 6 | `<CalendarEventRow>` | Time + title + status. Real component. |
| Model row | `.model-item` | 6 | `<ModelRow>` | Name + size + install state + actions. Real component. |
| Setup step row | `.setup-step` | 13 | Inline within `<SetupWizard>` screen. Not a general-purpose primitive. |
| Settings row | `.settings-row` | 17 | `<SettingsRow>` | Label + description + trailing control. Hugely reused. |
| Calendar detail meta row | `.calendar-detail-meta-row` | 2 | Inline in `<CalendarEventDetail>`. |

`<Card>` from shadcn: only used as chrome for `<MeetingDetail>` / settings
sections. Keep shadcn `<Card>` as-is; don't invent `<MeetingCard>` /
`<FolderCard>` wrappers.

**Consolidated row components:** `<MeetingRow>`, `<FolderRow>`,
`<CalendarEventRow>`, `<ModelRow>`, `<SettingsRow>` — 5 files, all with
clear multi-site usage.

---

## 6. Dialogs / modals / popups — shadcn `<Dialog>`, `<Popover>`

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Settings panel | `.settings-panel` + `.settings-backdrop` | 2+2 | `<Dialog>` (full-height variant) | |
| Setup wizard modal | `.setup-modal` | 2 | `<Dialog size="wizard">` | Used by SetupWizard screen. |
| AI query popup | `.ai-query-popup` / `.ai-query-container` | 2+2 | **Delete** — legacy path, superseded by Ask Bar. Confirm with product before removing. |
| Context menu (right-click) | `.context-menu` / `.context-menu-item` / `.context-menu-separator` | 2+7+2 | `<ContextMenu>` from shadcn (Radix) | |
| Folder pill dropdown | `.folder-pill-dropdown` + items | 2+4 | `<Popover>` + list | |
| Ask-bar history dropdown | `.ask-bar-history-dropdown` + items | 2+several | `<Popover>` + list | |
| Ask-bar chat history menu | `.ask-bar-chat-history-menu` | 3 | Same `<Popover>` pattern. |

**Consolidated dialogs/menus:** `<Dialog>`, `<Popover>`, `<ContextMenu>` — all
shadcn stock. `<ConfirmDialog>` convenience wrapper for "Delete meeting?" type
prompts — justify: 4+ confirm-style uses across the app.

---

## 7. Navigation / sidebar / tabs

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Main sidebar shell | `.sidebar` + `.sidebar-header` + `.sidebar-title` | 12 + 5 + 1 | `<Sidebar>` component (layout + header + resizer) | Real component — hosts meetings / folders / calendar nav. |
| Calendar sidebar | `.calendar-sidebar` + header | 2+2 | Same `<Sidebar>` in "calendar" mode. No second component. |
| Settings nav item | `.settings-nav-item` | 4 | Use `<Button variant="ghost">` in a left rail; no dedicated component. |
| Settings tab | `.settings-tab` | 5 | shadcn `<Tabs>` — keep. |
| Folder separator | `.folder-separator` | 3 | Inline `<hr>` styled in globals.css. |

**Consolidated:** `<Sidebar>` (1). No `<NavItem>` — `<Button>` covers it.

---

## 8. Folder picker / drag-drop

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Folder picker dropdown | `.folder-pill-dropdown` | 2 | `<FolderPicker>` | Combines trigger pill + popover + folder list. Real component (tight coupling between pill, popover, drag source). |
| Drop zone highlight | `.drop-zone` | 2 | Handled via `data-drop-active` on `<FolderRow>` — no component. |

**Consolidated:** `<FolderPicker>` (1).

---

## 9. Recording / waveform / status

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Status dot (ready / recording / paused / processing) | `.status-dot` + state classes | 4+4 | `<StatusDot state="…">` | Small visual, used in header + row context. |
| Header waveform (8 bars) | `.waveform` / `.waveform-bar` | 2+8 CSS rules, 8 static bars | `<Waveform size="header">` | |
| Ask-bar bubble waveform (16 bars) | `.bubble-waveform` / `.bubble-waveform-bar` | 2+16 | `<Waveform size="bubble">` | |
| Mini waveform (5 bars) | `.mini-waveform` / `.mini-waveform-bar` | 3+5 | `<Waveform size="mini">` | |
| Static waveform | `.waveform-static` | 3 | `<Waveform animated={false}>` | Same component, prop toggle. |
| Recording timer | `.recording-timer` | 1 | Inline `<span>` formatted from hook; no component. |

**Consolidated:** `<Waveform size="header\|bubble\|mini" animated>` (1) +
`<StatusDot>` (1).

---

## 10. Progress / setup wizard

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Setup progress bar | `.progress-bar` + `.progress-fill` | static + 3 | shadcn `<Progress>` | Stock. |
| Setup progress step | `.setup-progress-step` + `.active` + `.completed` | 6 | Inline within `<SetupWizard>`. Not reusable. |
| Setup header / footer / actions | `.setup-header`, `.setup-footer`, `.setup-actions` | 3+3+5 | Inline in SetupWizard — page-level layout, not a primitive. |
| Step icon / text / badge | `.step-icon`, `.step-text`, `.step-badge` | 2+2+5 | Inline; `.step-badge` → `<Badge>`. |

**Consolidated:** none unique to this section. `<SetupWizard>` is a screen,
not a component.

---

## 11. Chat / Ask-bar — the single biggest cluster

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Ask-bar shell | `.ask-bar` + `.ask-bar-inner` + `.ask-bar-row` | 2+13+2 | `<AskBar>` screen component (not a primitive; owns layout). |
| Ask-bar left / right groups | `.ask-bar-left` | 9 | Inline flex in AskBar. |
| Ask-bar transcript panel | `.ask-bar-transcript` + header + body | 4+5+1 | Inline in AskBar. |
| Ask-bar chat window | `.ask-bar-chat-window` + header + chevron | 4+2+2 | Inline in AskBar. |
| Ask-bar message (AI) | `.ask-bar-msg-ai` | 4 | `<ChatMessage role="ai">` | Shared with meeting detail chat — real component. |
| Thinking dots | `.ask-bar-thinking-dots` | 4 | Inline in `<ChatMessage>`. |
| History menu / item / actions | `.ask-bar-history-menu`, `.ask-bar-history-menu-item`, `.ask-bar-history-item*` | ~15 | Inline in AskBar popover content. |
| Starter prompt chip | `.ask-bar-prompt-chip` | 3 | `<Badge variant="outline" interactive>` — see §4. |
| Context menu (ask-bar) | `.ask-bar-item-context-menu` | 5 | Reuses `<ContextMenu>` from §6. |
| Mini rec controls | `.ask-bar-rec-controls` / `.bar-stop-btn` / `.bar-transcript-btn` | 3+1+11 | Inline in AskBar; reuses `<Button>` + `<Waveform>`. |

**Consolidated:** `<AskBar>` (screen, not counted against component budget) +
`<ChatMessage>` (1).

---

## 12. Detail page / notes / transcript

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Meeting detail shell | `.meeting-detail` / `.document-body` / `.meeting-header` | 2+1+1 | `<MeetingDetail>` screen — uses `<Card>`, `<Typography>`, `<Button>`. No new primitive. |
| Meeting title + edit affordance | `.meeting-title` + `.meeting-title-container` + `.meeting-title-input` | 2+2+2 | `<EditableTitle>` — justify: complex interaction (click → input → save/cancel) reused in folder rename too. |
| Notes editor | `.notes-editor` / `.notes-content` | 1+2 | Inline `<div contentEditable>` within MeetingDetail. |
| Streaming output | `.streaming-output` | 1 | Inline `<div>` — not a primitive. |
| Transcript content | `.transcript-content` + `.transcript-container` | 1+1 | Inline in MeetingDetail. |
| Key / action lists | `.key-points-list`, `.action-items-list` | 3+3 | Inline `<ul>` styled via globals.css. |

**Consolidated:** `<EditableTitle>` (1) — reused in 2+ places.

---

## 13. Announcement banner / debug console

| Legacy pattern | Selector | Uses | Consolidated | Notes |
|---|---|---:|---|---|
| Announcement banner | `.announcement-banner` + children | 8+many | `<AnnouncementBanner>` — 1 instance, but complex (icon, title, message, CTA, dismiss). Justify: keeps MainLayout clean. |
| Debug console | `.debug-console` + wrapper + toggle | 8+2+6 | `<DebugConsole>` — only mounted in dev mode. Justify: substantial, isolated, dev-only. |

**Consolidated:** `<AnnouncementBanner>` (1) + `<DebugConsole>` (1).

---

## Summary — component budget

### shadcn-new-york primitives (already in `components/ui/`):
`button`, `input`, `textarea`, `switch`, `select`, `badge`, `dialog`,
`popover`, `context-menu`, `tabs`, `progress`, `card`, `tooltip` — **13 files**,
all stock. `typography.tsx` is the 14th (Steno-specific fonts).

### App-level components (`components/`):

| # | Component | Why |
|---|---|---|
| 1 | `<Sidebar>` | Layout shell — meetings / folders / calendar modes. |
| 2 | `<MeetingRow>` | 21 legacy uses; active/drag/dot states. |
| 3 | `<FolderRow>` | 8 legacy uses; drop-target + menu. |
| 4 | `<CalendarEventRow>` | 6 legacy uses. |
| 5 | `<ModelRow>` | 6 legacy uses. |
| 6 | `<SettingsRow>` | 17 legacy uses. |
| 7 | `<FolderPicker>` | Pill + popover + drag source bound tightly. |
| 8 | `<Waveform>` | 3 sizes (header/bubble/mini) + static toggle. |
| 9 | `<StatusDot>` | 4 states; header + row reuse. |
| 10 | `<PrivacyBadge>` | SVG ghost tri-state — too much personality for `<Badge>`. |
| 11 | `<ChatMessage>` | Shared across Ask Bar + meeting detail. |
| 12 | `<EditableTitle>` | Click-to-edit reused for meeting title + folder rename. |
| 13 | `<ConfirmDialog>` | Delete / destructive confirms (4+ sites). |
| 14 | `<AnnouncementBanner>` | Substantial, isolated. |
| 15 | `<DebugConsole>` | Substantial, dev-only. |

### Screens (not counted — app-level routes, one per page):
`<MainLayout>`, `<MeetingDetail>`, `<AskBar>`, `<Settings>`, `<SetupWizard>`,
`<CalendarEventDetail>`.

### Total: 13 shadcn + 15 app components = **28 files in `components/`**

This exceeds the target of "fewer than ~15 files". Two paths to get under:

1. **Strict interpretation:** the ~15 target covers only `components/`
   (app-level). shadcn primitives live in `components/ui/` and don't count.
   Under that reading we're at **15 app files** — exactly on target.
2. **Looser interpretation:** combine close siblings. `<MeetingRow>` /
   `<FolderRow>` / `<CalendarEventRow>` / `<ModelRow>` → one `<ListRow>`
   primitive with variant slots. Cuts 3 files.

**Recommendation:** path 1. Each Row has distinct interaction (drag source vs.
drop target vs. time formatting vs. install actions). Collapsing them would
trade file count for per-call-site complexity. The ~15 target reads naturally
as "app-level" since the shadcn primitives are conventional and auditable on
their own.

---

## Patterns that stay inline (no component)

Documented here so the rule is visible — don't lift these into components
later without a justification:

- `.brand.home-btn` — logo link. One site. Inline `<button>`.
- `.record-controls`, `.header-actions`, `.header` — layout in `<MainLayout>`.
- `.drag-area` — 1 line of CSS, WebKit draggable region. Inline.
- `.sidebar-toggle-icon` — SVG in button. Inline.
- `.folder-separator` — styled `<hr>`.
- `.meeting-dot` — styled `<span>`.
- `.shortcut-hint` — styled `<kbd>`.
- `.meeting-title` (display-only rendering) — `<h1>` styled via typography.
- `.ghost-eyes` / `.ghost-body` — internals of `<PrivacyBadge>`.
- `.step-icon`, `.step-text`, `.step-header`, `.step-info` — SetupWizard
  internals.
- `.settings-backdrop` — belongs to `<Dialog>` overlay.
- `.w3`, `.org`, `.js` — legacy flag classes for third-party-model metadata,
  used as data attrs. Migrate to `data-*`.

---

## Open questions (resolve before starting Phase 2 tickets)

1. **AI query popup (`.ai-query-popup`)** — superseded by Ask Bar. Confirm
   removal with product before migrating.
2. **`<EditableTitle>` scope** — does folder rename reuse it, or stick with
   an inline rename control? If it stays inline for folders, merge into
   `<MeetingDetail>`.
3. **`<DebugConsole>`** — does the new UI still need it? Dev-only. If dropped,
   budget falls to 14 app components.
