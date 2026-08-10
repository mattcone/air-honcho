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
    /*
     * Vitest's default is 5s, which is a web-app default and wrong for this suite:
     * a lot of these tests play whole 100-turn games, and several play twenty of
     * them. Scattering per-test magic numbers to compensate turned into whack-a-mole
     * — the first CI run failed 11 tests across 5 files, several of which pass
     * locally in under a second.
     *
     * The measured gap is the point: that run took 1023s against 376s on the
     * development machine, a uniform ~2.7x. Any budget tuned by running it here is
     * therefore wrong by roughly 3x on CI, so the budget has to be set for the
     * SLOWEST place it runs, not the fastest.
     *
     * 120s covers every test in the suite except the handful of Monte-Carlo balance
     * fixtures, which carry their own explicit budgets sized off a measured local
     * time times three. Long enough that no honest test trips it; short enough that
     * a genuine hang still surfaces in two minutes rather than at the job limit.
     */
    testTimeout: 120_000,
  },
});
