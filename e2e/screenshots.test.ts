import {expect, PageAssertionsToHaveScreenshotOptions, test as baseTest, Page as BasePage} from '@playwright/test'
import {copyFile} from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'

type Page = BasePage & {snapshotScreen: (options?: PageAssertionsToHaveScreenshotOptions) => Promise<void>}
const test = baseTest.extend<{page: Page}>({
  page: async ({page}, use, testInfo) => {
    await use(
      Object.assign(page, {
        snapshotScreen: async (options?: PageAssertionsToHaveScreenshotOptions) => {
          const name = testInfo.title.split(' ')[1]
          await expect(page).toHaveScreenshot(`${name}.png`, options)
          await copyFile(testInfo.snapshotPath(`${name}.png`), `public/reports/${name}.png`)
        },
      }),
    )
  },
})

test.beforeEach(async ({context}) => {
  await context.addCookies([
    {
      name: 'gh_token',
      value: process.env.GH_TOKEN!.slice(),
      domain: '.mmkal.com',
      path: '/',
    },
  ])
})

test.afterEach(async ({page: _page}, testInfo) => {
  const name = testInfo.title.split(' ')[1]
  await copyFile(testInfo.snapshotPath(`${name}.png`), `public/reports/${name}.png`)
})

test('take vitest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/vitest/vitest/html/index.html`)
  await page.hover('text=add badly')
  await page.getByLabel('add badly').getByTestId('btn-open-details').click()
  await page.click('text=Report')
  await page.waitForSelector('text=AssertionError')
  await page.snapshotScreen()
})

test('take playwright screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/playwright/playwright-report/index.html`)
  await page.click('text=add badly')
  await page.waitForSelector('text=Error: expect(received).toEqual(expected)')
  await page.snapshotScreen()
})

test('take jest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/jest/report/jest_html_reporters.html`)
  await page.locator('[data-row-key*="adding.test.js"] [aria-label="Expand row"]').click()
  await page.waitForSelector('.ant-table-cell:has-text("Passed")')
  await page.waitForSelector('.ant-table-cell:has-text("Failed")')
  await page.snapshotScreen({fullPage: true})
})

test('take mocha screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/mocha/output.html`)
  await page.waitForSelector('text=AssertionError [ERR_ASSERTION]: Expected values to be strictly equal')
  await page.snapshotScreen()
})

test('take ava screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/ava/output.html`)
  await page.waitForSelector('text=add badly')
  await page.snapshotScreen()
})

test('take pytest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/pytest/report/index.html`)
  await page.waitForSelector('text=test.py:10: AssertionError')
  await page.snapshotScreen()
})

test('take go screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/go/test_report.html`)
  await page.click('.testResultGroup.failed')
  await page.click('.testGroupRow.failed')
  await page.waitForSelector('text=Result was incorrect')
  await page.snapshotScreen()
})

test('take eslint screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/eslint/.eslint-config-inspector`)
  await page.click('text=eslint/defaults/ignores')
  await page.waitForSelector('text=Ignore files globally')
  await page.snapshotScreen()
})

test('take website screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/website/demosite/dist/index.html`)
  await page.waitForSelector('text=Welcome to Starlight')
  await page.snapshotScreen()
})

test('take pdf screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/pdf/output.pdf`)
  await page.locator('embed').waitFor()
  await setTimeout(1000) // I don't think you can really test pdfs with playwright
  await page.snapshotScreen({
    clip: {x: 0, y: 0, width: 650, height: 350},
  })
})
