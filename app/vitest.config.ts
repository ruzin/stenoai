import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Unit tests for renderer hooks/logic. Separate from the Playwright e2e tiers
// (T1/T2): this runs pure React hooks under jsdom with no Electron, so
// react-query cache behaviour can be driven deterministically via controlled
// promises rather than real UI timing.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['renderer/src/**/*.test.{ts,tsx}'],
  },
});
