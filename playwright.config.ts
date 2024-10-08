import {defineConfig, devices, PlaywrightTestConfig} from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

export const STORAGE_STATE = path.join(__dirname, 'playwright/.auth/user.json')
const storageStateAgeMs = () => {
  try {
    const stat = fs.statSync(STORAGE_STATE)
    return Date.now() - stat.mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export default defineConfig({
  testDir: 'e2e',
  use: {
    colorScheme: 'dark',
    baseURL: 'http://localhost:3000',
  },
  projects: (() => {
    const defaultProjects: PlaywrightTestConfig['projects'] = [
      {
        // https://playwright.dev/docs/test-global-setup-teardown
        name: 'seed',
        testMatch: 'setup.seed.ts',
      },
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          storageState: STORAGE_STATE,
        },
        dependencies: ['seed'],
      },
    ]

    if (storageStateAgeMs() < 1000 * 60 * 60) {
      return defaultProjects.slice(1).map(p => ({...p, dependencies: p.dependencies?.filter(d => d !== 'seed')}))
    }
    return defaultProjects
  })(),
  webServer: {
    reuseExistingServer: true,
    command: 'pnpm dev',
    port: 3000,
  },
})
