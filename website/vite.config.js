import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ALL } from './src/vs/competitors.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const COMPETITOR_BY_SLUG = Object.fromEntries(ALL.map((c) => [c.slug, c]))

// Emit each /vs/<slug>/ page's FAQ structured data into its STATIC HTML at
// build time, sourced from competitors.js (single source of truth). This is
// what non-JS crawlers read — the pages are SEO surfaces, so the JSON-LD must
// exist without executing React. ComparisonPage no longer injects it client-side.
function faqJsonLdPlugin() {
  return {
    name: 'inject-vs-faq-jsonld',
    transformIndexHtml(html, ctx) {
      const match = (ctx.path || '').match(/\/vs\/([^/]+)\/index\.html$/)
      const data = match && COMPETITOR_BY_SLUG[match[1]]
      if (!data) return html
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: data.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }
      const tag = `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
      return html.replace('</head>', `  ${tag}\n</head>`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), faqJsonLdPlugin()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      // Multi-page build: each /vs/ page is its own HTML entry so it ships
      // with static per-page meta tags (title/canonical/OG) for SEO.
      input: {
        main: resolve(__dirname, 'index.html'),
        vs: resolve(__dirname, 'vs/index.html'),
        vsGranola: resolve(__dirname, 'vs/granola/index.html'),
        vsOtter: resolve(__dirname, 'vs/otter/index.html'),
        vsFireflies: resolve(__dirname, 'vs/fireflies/index.html'),
        vsMeetily: resolve(__dirname, 'vs/meetily/index.html'),
      },
    },
  },
})
