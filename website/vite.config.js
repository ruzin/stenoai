import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ALL as COMPETITORS } from './src/vs/competitors.js'
import { ALL as INDUSTRIES } from './src/enterprise/industries.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Map each SEO page's URL path -> the object holding its `faqs`, so the plugin
// below can emit FAQ structured data for both /vs/ and /enterprise/ pages.
const FAQ_BY_PATH = Object.fromEntries([
  ...COMPETITORS.map((c) => [`/vs/${c.slug}/index.html`, c]),
  ...INDUSTRIES.map((c) => [`/enterprise/${c.slug}/index.html`, c]),
])

// Emit each subpage's FAQ structured data into its STATIC HTML at build time,
// sourced from the same data module the React page renders from (single source
// of truth). These are SEO surfaces, so the JSON-LD must exist for non-JS
// crawlers without executing React; the pages don't inject it client-side.
function faqJsonLdPlugin() {
  return {
    name: 'inject-faq-jsonld',
    transformIndexHtml(html, ctx) {
      const data = FAQ_BY_PATH[ctx.path || '']
      if (!data || !data.faqs) return html
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
      // Multi-page build: each /vs/ and /enterprise/ page is its own HTML entry
      // so it ships with static per-page meta tags (title/canonical/OG) for SEO.
      input: {
        main: resolve(__dirname, 'index.html'),
        vs: resolve(__dirname, 'vs/index.html'),
        vsGranola: resolve(__dirname, 'vs/granola/index.html'),
        vsOtter: resolve(__dirname, 'vs/otter/index.html'),
        vsFireflies: resolve(__dirname, 'vs/fireflies/index.html'),
        vsMeetily: resolve(__dirname, 'vs/meetily/index.html'),
        enterprise: resolve(__dirname, 'enterprise/index.html'),
        entGovernment: resolve(__dirname, 'enterprise/government/index.html'),
        entDefense: resolve(__dirname, 'enterprise/defense/index.html'),
        entLegal: resolve(__dirname, 'enterprise/legal/index.html'),
        entHealthcare: resolve(__dirname, 'enterprise/healthcare/index.html'),
        entFinance: resolve(__dirname, 'enterprise/finance/index.html'),
        entExecutive: resolve(__dirname, 'enterprise/executive/index.html'),
      },
    },
  },
})
