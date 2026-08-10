/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Vite rejects unrecognized Host headers. Allow MagicDNS names so the dev
    // server can be reached over Tailscale, either via `tailscale serve` or by
    // binding directly with `npm run dev -- --host <tailscale-ip>`.
    // Tailnet-only: this is not a public exposure.
    allowedHosts: ['.ts.net'],
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    // The sim core must run headless in Node; the UI is not under test in Phase 0.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
