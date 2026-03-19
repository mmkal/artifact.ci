import {type Page} from '@playwright/test'

const appUrl = process.env.GITHUB_APP_URL || 'https://github.com/apps/artifact-ci'

export const installApp = async ({page}: {page: Page}) => {
  await page.goto(appUrl)
  await page.locator('text=Install').click()
  await page.locator('text=Install').click()
}

export const uninstallApp = async ({page}: {page: Page}) => {
  await page.goto(appUrl)
  await page.locator('text=Configure').click()
  page.once('dialog', dialog => dialog.accept())
  await page.locator('text=Uninstall').click()
}
