import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
      // Single source of truth for both runtimes: the main process reads these
      // same files from disk (app/i18n.js). Keeping one copy is why this points
      // outside the Vite root instead of duplicating them under renderer/src.
      '@locales': path.resolve(__dirname, 'locales'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemaps in dev only. Shipping .map files in the packaged DMG would
    // expose source internals and bloat the install size; on by default to
    // help with stack-trace debugging during development.
    sourcemap: process.env.NODE_ENV !== 'production',
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // locales/ sits above the Vite root (renderer/), so the dev server needs
      // explicit permission to serve it. `vite build` resolves it either way.
      allow: [path.resolve(__dirname, 'renderer'), path.resolve(__dirname, 'locales')],
    },
  },
});
