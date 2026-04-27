import {chromium, expect, test as setup, type Browser, type BrowserContext, type Page} from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {STORAGE_STATE} from '../playwright.config'

const AUTH_STATE_ENV = 'E2E_AUTH_STATE_JSON'
const MANUAL_LOGIN_TIMEOUT_MS = 1000 * 60 * 5
const REPO_URL = 'https://github.com/mmkal-bot/test-repo'
const REPO_READY_SELECTOR = '#repo-content-pjax-container #repository-container-header'
const GITHUB_ACTIONS_SECRETS_URL = 'https://github.com/mmkal/artifact.ci/settings/secrets/actions'

setup('setup: do login', async ({page}, testInfo) => {
  ensureAuthDirectory()
  const browser = page.context().browser()
  if (!browser) throw new Error('[e2e] Expected Playwright browser instance for seed setup')

  if (hasStorageStateFile()) {
    const isLoggedIn = await confirmLoggedIn(browser).catch(() => false)
    if (isLoggedIn) return
  }

  testInfo.setTimeout(MANUAL_LOGIN_TIMEOUT_MS + 60_000)

  if (process.env[AUTH_STATE_ENV]) {
    writeStorageStateFromEnv(process.env[AUTH_STATE_ENV])
    await confirmLoggedIn(browser)
    return
  }

  if (process.env.CI) {
    throw new Error(ciInstructions())
  }

  await createStorageStateInteractively()
  await confirmLoggedIn(browser)
})

function ensureAuthDirectory() {
  fs.mkdirSync(path.dirname(STORAGE_STATE), {recursive: true})
}

function hasFreshStorageState() {
  try {
    const stat = fs.statSync(STORAGE_STATE)
    return stat.mtimeMs > Date.now() - 1000 * 60 * 60
  } catch {
    return false
  }
}

function writeStorageStateFromEnv(value: string) {
  const parsed = JSON.parse(value)
  fs.writeFileSync(STORAGE_STATE, JSON.stringify(parsed, null, 2))
  console.log(`[e2e] wrote auth state from ${AUTH_STATE_ENV} to ${STORAGE_STATE}`)
}

async function createStorageStateInteractively() {
  const browser = await chromium.launch({headless: false, slowMo: 100})
  const context = await browser.newContext()
  const manualPage = await context.newPage()
  let watcher: Promise<void> | undefined

  try {
    await manualPage.goto('https://github.com/login')

    console.log(interactiveInstructions())
    await manualPage.locator('body').waitFor({timeout: 15_000})

    watcher = watchForSuccessfulLogin(context, manualPage)
    await waitForStorageStateFile()
    console.log(`[e2e] Saved Playwright auth state to ${STORAGE_STATE}`)
  } finally {
    await watcher?.catch(() => {})
    await browser.close()
  }
}

async function watchForSuccessfulLogin(context: BrowserContext, page: Page) {
  const started = Date.now()

  while (Date.now() - started < MANUAL_LOGIN_TIMEOUT_MS) {
    try {
      await page.goto(REPO_URL, {waitUntil: 'domcontentloaded'})
      await page.locator(REPO_READY_SELECTOR).waitFor({timeout: 5000})
      await context.storageState({path: STORAGE_STATE})
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

async function waitForStorageStateFile() {
  const started = Date.now()

  while (Date.now() - started < MANUAL_LOGIN_TIMEOUT_MS) {
    if (hasFreshStorageState()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(
    `[e2e] Timed out waiting ${MANUAL_LOGIN_TIMEOUT_MS / 60_000} minutes for ${STORAGE_STATE} to be created.`,
  )
}

async function confirmLoggedIn(browser: Browser) {
  const context = await browser.newContext({storageState: STORAGE_STATE})

  try {
    const page = await context.newPage()
    await page.goto(REPO_URL)
    await expect(page.locator(REPO_READY_SELECTOR)).toBeVisible({timeout: 30_000})
    return true
  } finally {
    await context.close()
  }
}

function hasStorageStateFile() {
  try {
    fs.accessSync(STORAGE_STATE)
    return true
  } catch {
    return false
  }
}

function interactiveInstructions() {
  return [
    '[e2e] YOU HAVE TO LOG IN MATE.',
    `[e2e] A headed browser window is open. Complete GitHub sign-in and any device verification within ${MANUAL_LOGIN_TIMEOUT_MS / 60_000} minutes.`,
    `[e2e] When login reaches ${REPO_URL}, the auth state will be saved automatically.`,
    `[e2e] After it saves, you can copy it for CI with:\n  cat ${STORAGE_STATE} | pbcopy && open ${GITHUB_ACTIONS_SECRETS_URL}`,
  ].join('\n')
}

function ciInstructions() {
  return [
    `[e2e] Missing ${AUTH_STATE_ENV} and no fresh ${STORAGE_STATE} is available in CI.`,
    '[e2e] Run `pnpm e2e -g "add multiply test"` locally and complete the interactive login when prompted.',
    '[e2e] Then copy the file and open the GitHub Actions secrets page with:',
    `  cat ${STORAGE_STATE} | pbcopy && open ${GITHUB_ACTIONS_SECRETS_URL}`,
  ].join('\n')
}
