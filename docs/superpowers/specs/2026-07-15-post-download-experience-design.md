# Post-download experience — design

## Goal

Today, clicking any "Download" CTA on the marketing site links straight to the
`.dmg`/`.exe` on GitHub Releases — the visitor gets a file with no next step.
For Mac (the primary, stable build), we're adding an intermediate `/download`
page — modeled directly on `notes.granola.ai/download` — that fires the
`.dmg` download automatically and walks the visitor through installing it:
open the disk image, drag the app into Applications, launch it.

Windows is out of scope for this change; its CTA keeps linking straight to the
`.exe`, unchanged.

## Reference: how Granola does it (verified by inspecting the live site)

- Every download CTA on `granola.ai` (nav, hero, features, pricing) points to
  `notes.granola.ai/download`, not to the installer directly.
- `/download` is a standalone page: no nav, no footer, just centered content.
- A status pill reads "PREPARING DOWNLOAD" then flips to "DOWNLOAD STARTED"
  once the actual file download has fired client-side.
- The three step illustrations are real PNGs
  (`/installation-steps/installation-step-0{1,2,3}.png`), not coded
  mockups — served through Next's image optimizer.
- "download manually" links to a stable redirect endpoint
  (`api.granola.ai/v1/download-latest`).
- The steps read: open `Granola.dmg` from Downloads → drag the Granola icon
  into Applications → open Granola from Applications.

## Dependency on PR #338 (Astro migration)

This depends on the Astro file structure introduced by PR #338
(`website/src/pages/*.astro`, `BaseLayout.astro`, existing `lib`/analytics
conventions), which is not yet merged into `main`. Practically:

- Build this on top of the local `astro-migration-plan` branch.
- Once #338 merges to `main`, rebase this branch onto `main` before opening
  its own PR.

## Route & files

- New page: `website/src/pages/download.astro`, wrapped in `BaseLayout` with
  `noindex={true}`, `title="Download Steno"`. No `Nav`/`Footer` rendered —
  standalone page, matching Granola's chrome-free layout.
- New shared module `website/src/lib/downloads.js` exporting `MAC_DMG_URL` and
  `WINDOWS_EXE_URL`. Today that URL is hardcoded independently in
  `Hero.astro` and `CTAFooter.astro` (and would be a third time in
  `download.astro`) — consolidate into one constant now that all three call
  sites are being touched.
- `Hero.astro`'s and `CTAFooter.astro`'s Mac buttons change from
  `href={MAC_DMG_URL}` to `href="/download"`. Windows buttons are untouched
  (still direct `.exe` link). The existing per-button
  `trackDownload('hero'|'cta_footer', 'arm64')` click tracking is unchanged —
  it's still a valid "clicked to start" signal, distinct from the new page's
  own tracking.

## Trigger mechanism

- A small inline `<script>` on `download.astro` (same pattern as the existing
  OS-detection script in `Hero.astro` — plain JS, no framework) sets
  `window.location.href = MAC_DMG_URL` on load. GitHub Releases serves the
  asset with `Content-Disposition: attachment`, so this starts a native
  browser download without navigating away from the page (no popup-blocker
  risk, unlike `window.open`).
- Status pill shows "DOWNLOAD STARTED" immediately — no artificial
  "preparing" delay.
- The "if it didn't start, download manually" link is a plain
  `<a href={MAC_DMG_URL}>` — always visible, works even with JS disabled.
- No OS detection/gating on this page itself — it's reached only via the Mac
  CTA today, and always serves/triggers the Mac build regardless of visiting
  UA. If a non-Mac visitor lands here directly (bookmark, shared link), they
  just see the same Mac instructions and the same Mac `.dmg` fires.

## Content & layout

- Pill: "DOWNLOAD STARTED" with check icon, small-caps, `--surface-raised`
  background.
- Heading: "Thanks for downloading! Just a few steps left" in
  `var(--font-serif)` — already the site's existing display-heading font
  (used in `CTAFooter.astro`'s headline), so this is consistent with the
  site's own type system, not a Granola-specific borrow.
- Subtext with the manual-download link inline.
- Three-column step row, each: numbered circle badge, an `<img>` card (images
  supplied separately — `installation-step-01/02/03` equivalents, Steno
  paper/ink styling), caption with bold keywords, adapted to Steno naming
  (confirmed via `app/package.json`: productName "Steno", DMG title "Steno
  Installer"):
  1. "Open **Steno.dmg** from your Downloads folder"
  2. "Drag the **Steno** icon into your Applications folder"
  3. "Open the **Steno** app from your Applications folder"
- Responsive: three-column row collapses to a single stacked column below the
  site's existing tablet/mobile breakpoint.
- Respects existing light/dark tokens — no new colors introduced.

## Analytics

- On mount: fire `trackDownload('download_page_auto', 'arm64')` when the
  auto-trigger fires — this becomes the canonical "download actually
  started" signal.
- On manual link click: `trackDownload('download_page_manual', 'arm64')`.
- No new analytics functions needed — reuses the existing
  `trackDownload(location, arch)` from `website/src/analytics.js`, just with
  new `location` values. `BaseLayout`'s existing delegated `data-track`
  listener picks these up the same way it does for other buttons.

## Testing / verification

- The website isn't covered by the root Electron `e2e/` suite (that drives
  the packaged app, not the marketing site) — no existing website test
  harness was found. Verification is manual: run the Astro dev server, click
  through Hero/CTAFooter → `/download`, confirm the `.dmg` fires, confirm
  dark mode, confirm mobile stacking, confirm the manual link works.

## Out of scope

- Windows post-download experience (may follow later, separate design).
- Architecture picker on the Mac page (today's Mac build is arm64-only, no
  universal/x64 binary exists).
- Any change to the actual GitHub Releases artifact naming/contents.
