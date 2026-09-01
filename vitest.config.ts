import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suite has its own config and its own command, because it
    // needs an Opengist in Docker. Excluding it here keeps `npm test` runnable
    // with nothing installed, and keeps the coverage numbers below comparable
    // to what they measured before it existed.
    exclude: [...configDefaults.exclude, 'test/integration/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires loadConfig/createServer to the stdio
      // transport; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Set just below the measured values (97.74 / 89.42 / 99.13 / 98.24 at
      // the time of writing), with headroom on functions. Raise these when the
      // measurement rises; answer a drop with tests, never by lowering them.
      thresholds: {
        statements: 96,
        branches: 87,
        functions: 94,
        lines: 97,
      },
    },
  },
});
