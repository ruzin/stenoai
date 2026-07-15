# Post-Download Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/download` page to the (soon-to-be-Astro) marketing site that Mac visitors land on after clicking Download — it fires the `.dmg` automatically and shows 3 steps to finish installing, modeled on `notes.granola.ai/download`.

**Architecture:** A new static Astro page (`website/src/pages/download.astro`) that a small inline script redirects to the GitHub Releases `.dmg` URL on load (triggering a native browser download, no page unload). `Hero.astro`'s and `CTAFooter.astro`'s Mac buttons link to `/download?src=<origin>` instead of the `.dmg` directly; Windows is untouched. A new `website/src/lib/downloads.js` module holds the two release URLs so they're defined once instead of three times.

**Tech Stack:** Astro (static output), Tailwind v4 utilities + component-scoped `<style>`, existing `website/src/analytics.js` (PostHog).

**Dependency:** This plan targets the Astro file structure from PR #338 (`WilliamDrewett/astro-migration-plan`), which is not yet merged to `main`. Task 1 rebases the current branch onto that branch so the files this plan touches actually exist. Once #338 lands on `main`, this branch will need a further rebase onto `main` before its own PR opens — not covered by this plan (do it as a normal rebase when the time comes; no new conflicts are expected since this plan's changes are additive to files #338 introduces).

---

### Task 1: Rebase onto the Astro migration branch

**Files:** none (git operation only)

- [ ] **Step 1: Confirm the current branch and check for a clean tree**

Run: `git status`
Expected: `On branch WilliamDrewett/post-download-experience`, working tree clean (the design spec commit `ea91c1a` should already be the tip).

- [ ] **Step 2: Rebase onto the local Astro migration branch**

Run: `git rebase WilliamDrewett/astro-migration-plan`
Expected: `Successfully rebased and updated refs/heads/WilliamDrewett/post-download-experience.` — the branch's merge-base with `astro-migration-plan` is the same commit both branches share, and this branch only carries one docs-only commit on top, so no conflicts are expected. If a conflict does appear, stop and resolve it manually rather than force-resolving blindly (unexpected conflicts here mean the two branches diverged more than assumed).

- [ ] **Step 3: Verify the Astro site now exists and builds**

Run: `cd website && npm install && npm run build`
Expected: install completes, `astro build` completes with no errors, output lists the existing pages (`/`, `/404`, `/privacy/`, `/terms/`, `/vs/*`, `/enterprise/*`).

---

### Task 2: Add the shared download-URL module

**Files:**
- Create: `website/src/lib/downloads.js`

- [ ] **Step 1: Create the module**

```js
export const MAC_DMG_URL =
  "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
export const WINDOWS_EXE_URL =
  "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";
```

- [ ] **Step 2: Commit**

```bash
git add website/src/lib/downloads.js
git commit -m "feat(website): add shared download URL constants"
```

---

### Task 3: Point Hero's Mac button at `/download`

**Files:**
- Modify: `website/src/sections/Hero.astro`

- [ ] **Step 1: Replace the inline URL constants with the shared module**

Find:
```astro
import AppleIcon from "../components/icons/AppleIcon.astro";
import WindowsIcon from "../components/icons/WindowsIcon.astro";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";
---
```

Replace with:
```astro
import AppleIcon from "../components/icons/AppleIcon.astro";
import WindowsIcon from "../components/icons/WindowsIcon.astro";
import { WINDOWS_EXE_URL } from "../lib/downloads";
---
```

- [ ] **Step 2: Repoint the Mac CTA to `/download` and drop its click tracking**

The Mac button's own click is no longer the canonical download signal — `/download` tracks the real download once it actually fires (see Task 6), tagged with which button sent the visitor via `?src=`. Tracking two events for the same download would double-count it.

Find:
```astro
      <a
        href={DOWNLOAD_ARM}
        data-track="download"
        data-location="hero"
        data-arch="arm64"
        data-os-cta="mac"
        class="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline"
      >
        <AppleIcon size={15} />
        <span data-os-cta-label="mac">Download for macOS</span>
      </a>
      <a
        href={DOWNLOAD_WIN}
        data-track="download"
        data-location="hero"
        data-arch="win-x64"
        data-os-cta="windows"
        class="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline"
        style="display: none"
      >
        <WindowsIcon size={15} />
        <span data-os-cta-label="windows">Download for Windows (alpha)</span>
      </a>
```

Replace with:
```astro
      <a
        href="/download?src=hero"
        data-os-cta="mac"
        class="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline"
      >
        <AppleIcon size={15} />
        <span data-os-cta-label="mac">Download for macOS</span>
      </a>
      <a
        href={WINDOWS_EXE_URL}
        data-track="download"
        data-location="hero"
        data-arch="win-x64"
        data-os-cta="windows"
        class="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline"
        style="display: none"
      >
        <WindowsIcon size={15} />
        <span data-os-cta-label="windows">Download for Windows (alpha)</span>
      </a>
```

Note: the `<script>` block further down in this file (client-side OS detection that reorders/shows the two buttons) references the buttons only via `data-os-cta`/`id="hero-cta"` and never touches `DOWNLOAD_ARM`/`DOWNLOAD_WIN` — it needs no changes.

- [ ] **Step 3: Verify the build is still clean**

Run: `cd website && npm run build`
Expected: builds with no errors (this catches a broken import immediately, since Astro fails the build on an unresolved import).

- [ ] **Step 4: Commit**

```bash
git add website/src/sections/Hero.astro
git commit -m "feat(website): route Hero's Mac download button through /download"
```

---

### Task 4: Point CTAFooter's Mac button at `/download`

**Files:**
- Modify: `website/src/sections/CTAFooter.astro`

- [ ] **Step 1: Replace the inline URL constants with the shared module**

Find:
```astro
import AppleIcon from "../components/icons/AppleIcon.astro";
import WindowsIcon from "../components/icons/WindowsIcon.astro";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";
---
```

Replace with:
```astro
import AppleIcon from "../components/icons/AppleIcon.astro";
import WindowsIcon from "../components/icons/WindowsIcon.astro";
import { WINDOWS_EXE_URL } from "../lib/downloads";
---
```

- [ ] **Step 2: Repoint the Mac CTA to `/download` and drop its click tracking**

Find:
```astro
          <a
            href={DOWNLOAD_ARM}
            data-track="download"
            data-location="cta_footer"
            data-arch="arm64"
            class="btn-base btn-primary no-underline"
          >
            <AppleIcon size={15} /> Download for Apple Silicon
          </a>
          <a
            href={DOWNLOAD_WIN}
            data-track="download"
            data-location="cta_footer"
            data-arch="win-x64"
            class="btn-base btn-ghost no-underline"
          >
            <WindowsIcon size={15} /> Download for Windows (alpha)
          </a>
```

Replace with:
```astro
          <a
            href="/download?src=cta_footer"
            class="btn-base btn-primary no-underline"
          >
            <AppleIcon size={15} /> Download for Apple Silicon
          </a>
          <a
            href={WINDOWS_EXE_URL}
            data-track="download"
            data-location="cta_footer"
            data-arch="win-x64"
            class="btn-base btn-ghost no-underline"
          >
            <WindowsIcon size={15} /> Download for Windows (alpha)
          </a>
```

- [ ] **Step 3: Verify the build is still clean**

Run: `cd website && npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add website/src/sections/CTAFooter.astro
git commit -m "feat(website): route CTAFooter's Mac download button through /download"
```

---

### Task 5: Add placeholder step illustrations

**Files:**
- Create: `website/public/images/download-steps/step-1.svg`
- Create: `website/public/images/download-steps/step-2.svg`
- Create: `website/public/images/download-steps/step-3.svg`

You said you'll design the real illustrations (open Steno.dmg / drag into Applications / launch from Applications) separately. These placeholders use the site's actual paper/ink tokens so the page doesn't ship with broken images or an unstyled gray box in the meantime — swap the three files at these exact paths when the real art is ready, no code changes needed elsewhere.

- [ ] **Step 1: Create the three placeholder SVGs**

`website/public/images/download-steps/step-1.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <rect x="1" y="1" width="638" height="478" rx="16" fill="#F5F3EC" stroke="#E5DFD1" stroke-width="2"/>
  <text x="320" y="248" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" fill="#6B6B66">Step 1 illustration</text>
</svg>
```

`website/public/images/download-steps/step-2.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <rect x="1" y="1" width="638" height="478" rx="16" fill="#F5F3EC" stroke="#E5DFD1" stroke-width="2"/>
  <text x="320" y="248" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" fill="#6B6B66">Step 2 illustration</text>
</svg>
```

`website/public/images/download-steps/step-3.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <rect x="1" y="1" width="638" height="478" rx="16" fill="#F5F3EC" stroke="#E5DFD1" stroke-width="2"/>
  <text x="320" y="248" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" fill="#6B6B66">Step 3 illustration</text>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add website/public/images/download-steps/
git commit -m "feat(website): add placeholder download-step illustrations"
```

---

### Task 6: Create the `/download` page

**Files:**
- Create: `website/src/pages/download.astro`

- [ ] **Step 1: Create the page**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { Check } from "lucide-react";
import { MAC_DMG_URL } from "../lib/downloads";

const title = "Download Steno for Mac";
const description = "Your Steno download is starting. Follow these steps to finish installing Steno.";
---

<BaseLayout title={title} description={description} noindex>
  <main class="container-site" style="padding-top: 96px; padding-bottom: 96px;">
    <div class="text-center" style="max-width: 640px; margin: 0 auto;">
      <div class="download-pill">
        <Check size={13} aria-hidden="true" />
        <span>Download started</span>
      </div>

      <h1 class="download-heading">Thanks for downloading!<br />Just a few steps left</h1>

      <p class="text-fg-2 text-base mb-16">
        Your download will begin automatically. If it didn't start,
        <a
          href={MAC_DMG_URL}
          data-track="download"
          data-location="download_page:manual"
          data-arch="arm64"
          class="download-manual-link"
        >
          download Steno manually
        </a>.
      </p>
    </div>

    <div class="download-steps">
      <div class="download-step">
        <div class="download-step-badge">1</div>
        <img src="/images/download-steps/step-1.svg" alt="" width="320" height="240" class="download-step-image" />
        <p class="download-step-caption">
          Open <strong>Steno.dmg</strong> from your <strong>Downloads</strong> folder
        </p>
      </div>
      <div class="download-step">
        <div class="download-step-badge">2</div>
        <img src="/images/download-steps/step-2.svg" alt="" width="320" height="240" class="download-step-image" />
        <p class="download-step-caption">
          Drag the <strong>Steno</strong> icon into your <strong>Applications</strong> folder
        </p>
      </div>
      <div class="download-step">
        <div class="download-step-badge">3</div>
        <img src="/images/download-steps/step-3.svg" alt="" width="320" height="240" class="download-step-image" />
        <p class="download-step-caption">
          Open the <strong>Steno</strong> app from your <strong>Applications</strong> folder
        </p>
      </div>
    </div>
  </main>

  <script>
    import { trackDownload } from "../analytics";
    import { MAC_DMG_URL } from "../lib/downloads";

    // Attribute the download to whichever button sent the visitor here
    // (?src=hero / ?src=cta_footer), or "direct" for a bookmarked/shared
    // link straight to this page.
    const params = new URLSearchParams(window.location.search);
    const src = params.get("src") || "direct";
    trackDownload(`download_page:${src}`, "arm64");

    // GitHub Releases serves this with Content-Disposition: attachment, so
    // this starts a native browser download without navigating away.
    window.location.href = MAC_DMG_URL;
  </script>

  <style>
    .download-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 9999px;
      background: var(--surface-sunken);
      border: 1px solid var(--border);
      color: var(--fg-2);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .download-heading {
      font-family: var(--font-serif);
      font-weight: 400;
      font-size: clamp(30px, 4.2vw, 42px);
      line-height: 1.15;
      letter-spacing: -0.02em;
      color: var(--fg-1);
      margin: 20px 0 12px;
    }

    .download-manual-link {
      color: var(--fg-1);
      text-decoration: underline;
    }

    .download-steps {
      display: flex;
      flex-direction: column;
      gap: 40px;
      max-width: 900px;
      margin: 0 auto;
    }

    @media (min-width: 768px) {
      .download-steps {
        flex-direction: row;
        justify-content: center;
        gap: 24px;
      }
    }

    .download-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      max-width: 280px;
      margin: 0 auto;
    }

    .download-step-badge {
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: var(--primary);
      color: var(--primary-fg);
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .download-step-image {
      width: 100%;
      height: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-sunken);
      display: block;
    }

    .download-step-caption {
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.5;
      color: var(--fg-2);
      text-align: center;
    }

    .download-step-caption strong {
      color: var(--fg-1);
      font-weight: 600;
    }
  </style>
</BaseLayout>
```

Notes on choices already made in this file:
- No nav/footer, matching Granola's chrome-free page and this codebase's own `404.astro` pattern.
- `noindex` — this is a transactional landing spot, not something that should rank in search.
- The pill renders "Download started" immediately (no "preparing" intermediate state) — the file download and the pill are both correct from first paint, no artificial delay.
- `alt=""` on the three step images: each image is purely decorative next to its own descriptive caption text, so giving it an accessible name would announce the same content twice to a screen reader.
- The inline `<script>` imports directly from `../analytics` rather than relying on `BaseLayout`'s delegated `[data-track]` click listener, because this tracking call fires on page load, not a click.

- [ ] **Step 2: Verify the build**

Run: `cd website && npm run build`
Expected: builds with no errors; build output includes a `/download/` route (or `/download.html`, depending on `trailingSlash` config — check against how `/privacy/` and `/terms/` are emitted in the same build output and confirm this page matches).

- [ ] **Step 3: Commit**

```bash
git add website/src/pages/download.astro
git commit -m "feat(website): add /download post-download-experience page"
```

---

### Task 7: Manual verification pass

**Files:** none (verification only — there is no automated test harness for the marketing website; the root `e2e/` suite drives the packaged Electron app, not this site)

- [ ] **Step 1: Lint**

Run: `cd website && npm run lint`
Expected: no errors.

- [ ] **Step 2: Start the dev server**

Run: `cd website && npm run dev`
Expected: server starts, prints a local URL (typically `http://localhost:4321`).

- [ ] **Step 3: Walk the Hero CTA path in a real browser**

Open the dev URL, confirm the Mac hero button reads "Download for macOS" and its link is `/download?src=hero`. Click it. Confirm:
- URL becomes `/download?src=hero`.
- No nav/footer is present, just the centered content.
- The pill reads "Download started" immediately.
- A `Steno...dmg` (or whatever the dev build's release asset resolves to) file download is triggered by the browser.
- The 3 steps render with the placeholder illustrations and correct captions ("Steno.dmg" / "Steno" / "Applications" bolded).
- The "download Steno manually" link is present and points at the same `.dmg` URL.

- [ ] **Step 4: Walk the CTAFooter path**

Scroll to the footer CTA section, click "Download for Apple Silicon", confirm the URL becomes `/download?src=cta_footer` and the same page renders correctly.

- [ ] **Step 5: Confirm Windows is untouched**

On both Hero and CTAFooter, confirm the Windows button still links straight to the `stenoAI-windows-x64.exe` URL (inspect the link — don't actually need to complete the Windows download).

- [ ] **Step 6: Confirm dark mode**

Toggle the site's dark mode (however it's triggered elsewhere on the site — check `Nav`), reload `/download`, confirm the pill/heading/step cards use the dark tokens and remain legible (no hardcoded light-only colors — everything in `download.astro` uses `var(--...)` tokens, so this should be automatic).

- [ ] **Step 7: Confirm mobile layout**

Resize the browser (or use dev tools device toolbar) to a narrow viewport (e.g. 390px wide). Confirm the 3 steps stack vertically instead of overflowing horizontally.

- [ ] **Step 8: Confirm direct navigation**

Navigate directly to `/download` (no `?src=` param) in a fresh tab. Confirm it still renders and still triggers the download (this covers the "bookmarked/shared link" case — no OS gating, no broken state from a missing query param).

---

## Self-review notes (for whoever executes this plan)

- If `npm run build` in Task 1 fails or the rebase in Task 1 conflicts, stop — that means the Astro branch has moved since this plan was written, and the file contents quoted in Tasks 3/4/6 (which were read directly from `WilliamDrewett/astro-migration-plan` at rebase time) may no longer match. Re-read the current file contents before applying the `Find`/`Replace` edits.
- Task 3 and Task 4's "Find" blocks are exact quotes of the current file contents (verified by reading the branch directly) — if a `Find` block doesn't match exactly, do not force it; re-check the live file.
