import { defineConfig } from 'vitest/config'

export default defineConfig({
  // the web app's demo switch (dashboard/vite.config.ts); tests run the live app's code
  define: { __DEMO__: 'false' },
  test: {
    // integration + chaos suites share one Postgres database, so files run one at a time
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 30_000,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/coldopen_test',
      // every test request comes from one address; the limits have tests of their own
      RATE_LIMIT_PER_MINUTE: '100000',
    },
  },
})
