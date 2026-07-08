import path from 'node:path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  resolve: {
    // mirror the tsconfig/vite aliases so tests can import app modules
    alias: {
      '@artifact/domain': path.resolve(__dirname, 'packages/domain/src'),
      '@artifact/config': path.resolve(__dirname, 'packages/config/src'),
    },
  },
  test: {
    // src/action tests use node:test, e2e uses playwright — both excluded
    include: ['{apps,packages}/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})
