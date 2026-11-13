import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Main-process modules import electron; tests run them under plain Node.
    alias: { electron: resolve(__dirname, 'tests/stubs/electron.ts') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
