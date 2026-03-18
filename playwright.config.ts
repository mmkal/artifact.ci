import 'dotenv/config'
import {defineConfig, devices, type PlaywrightTestConfig} from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

export const STORAGE_STATE = path.join(import.meta.dirname, 'playwright/.auth/user.json')
const hasBotCredentials = Boolean(process.env.MMKAL_BOT_CREDENTIALS)
const hasFreshStorageState = () => storageStateAgeMs() < 1000 * 60 * 60
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
    baseURL: 'http://localhost:1337',
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
          ...(hasFreshStorageState() ? {storageState: STORAGE_STATE} : {}),
        },
        dependencies: ['seed'],
      },
    ]

    if (!hasBotCredentials) {
      return defaultProjects.slice(1).map(p => ({...p, dependencies: p.dependencies?.filter(d => d !== 'seed')}))
    }

    if (hasFreshStorageState()) {
      return defaultProjects.slice(1).map(p => ({...p, dependencies: p.dependencies?.filter(d => d !== 'seed')}))
    }
    return defaultProjects
  })(),
  webServer: {
    reuseExistingServer: true,
    command: 'pnpm dev',
    port: 1337,
  },
})
