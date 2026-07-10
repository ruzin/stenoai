import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
