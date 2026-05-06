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
  },
});
