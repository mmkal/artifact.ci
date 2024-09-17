import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: {
    colorScheme: 'dark',
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    reuseExistingServer: true,
    command: 'pnpm dev',
    port: 3000,
  },
})
