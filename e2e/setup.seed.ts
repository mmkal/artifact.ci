import {test as setup} from '@playwright/test'
import * as fs from 'fs'
import {STORAGE_STATE} from '../playwright.config'

setup('setup: do login', async ({page}) => {
  try {
    const stat = fs.statSync(STORAGE_STATE)
    if (stat.mtimeMs > Date.now() - 1000 * 60 * 60) {
      return
    }
  } catch {
    // STORAGE_STATE prolly doesn't exist yet
  }
  await page.goto('https://github.com/login')
  await page.locator('#login_field').fill('mmkal-bot')
  await page.locator('#password').fill('*K.eA?svK>Jd8.yEJHo7T}RA')
  await page.getByText('Sign in', {exact: true}).click()

  await page.goto('https://github.com/mmkal-bot/test-repo')
  await page.locator('text=a test repo for testing and repoing').waitFor()
  await page.context().storageState({path: STORAGE_STATE})
})
