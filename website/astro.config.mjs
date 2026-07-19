import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
export default defineConfig({
  site: 'https://stenoai.co',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.startsWith('https://stenoai.co/download'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Dev-server-only workaround: the on-demand dep transform in this Vite
    // version fails to detect react-dom/client's named exports (createRoot),
    // breaking every React island's hydration. Forcing these into the
    // upfront optimizeDeps pre-bundle avoids that code path entirely.
    optimizeDeps: {
      include: ['react-dom/client', 'react-dom'],
    },
  },
})
