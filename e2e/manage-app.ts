import {Page} from '@playwright/test'

export const installApp = async ({page}: {page: Page}) => {
  await page.goto('https://github.com/apps/artifact-ci')
  await page.locator('text=Install').click()
  await page.locator('text=Install').click()
}

export const uninstallApp = async ({page}: {page: Page}) => {
  await page.goto('https://github.com/apps/artifact-ci')
  await page.locator('text=Configure').click()
  page.once('dialog', dialog => dialog.accept())
  await page.locator('text=Uninstall').click()
}
