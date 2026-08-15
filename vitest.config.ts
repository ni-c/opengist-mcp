import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires loadConfig/createServer to the stdio
      // transport; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Set just below the measured values (98.49 / 88.44 / 99.04 / 98.59 at
      // the time of writing), with headroom on functions. Raise these when the
      // measurement rises; answer a drop with tests, never by lowering them.
      thresholds: {
        statements: 96,
        branches: 86,
        functions: 94,
        lines: 96,
      },
    },
  },
});
