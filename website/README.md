# Steno marketing website

Part of the [Steno](https://github.com/ruzin/stenoai) project, licensed under [MIT](../LICENSE).

Built with [Astro](https://astro.build) — static output, React islands for
interactive pieces (nav, FAQ accordion, animated hero demo), Tailwind v4.

- `npm run dev` — dev server
- `npm run build` — static build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` — ESLint (JS/JSX + `.astro` files)

See `src/content/README.md` for the editorial policy behind the `/vs/` and
`/enterprise/` content collections.

## SEO / URL structure

Migrated from a Vite+React SPA to this Astro static site. `/enterprise/*` and
`/vs/*` kept the same URL slugs as before, so existing search equity and
inbound links carry over. `/privacy` and `/terms` moved from flat `.html`
files to trailing-slash directory routes (`trailingSlash: 'always'`,
`build.format: 'directory'` in `astro.config.mjs`); `public/privacy.html` and
`public/terms.html` are static meta-refresh redirect stubs preserving the old
URLs.

The site deploys as a static export to GitHub Pages
(`.github/workflows/deploy-website.yml`), which has **no server-side
redirect layer**. If you rename or remove a page, add a static redirect
stub for the old URL under `public/` (see `public/privacy.html` for the
pattern) — otherwise the old URL 404s with no fallback. Astro's `redirects`
config key does *not* work for this: combined with `trailingSlash: 'always'`
it generates the stub as `<old-path>/index.html` (a directory), which most
static file servers won't resolve for a request to the bare
`<old-path>` — confirmed 404 on Astro's own preview server.
