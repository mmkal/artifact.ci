import {Page, PageScreenshotOptions, test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'

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

const handlers: Record<
  string,
  {
    entrypoint: string
    handler: (page: Page) => Promise<void>
    screenshotOptions?: PageScreenshotOptions
  }
> = {
  vitest: {
    entrypoint: 'vitest/html/index.html',
    handler: async page => {
      await page.hover('text=add badly')
      await page.getByLabel('add badly').getByTestId('btn-open-details').click()
      await page.click('text=Report')
      await page.waitForSelector('text=AssertionError')
    },
  },
  playwright: {
    entrypoint: 'playwright-report/index.html',
    handler: async page => {
      await page.click('text=add badly')
      await page.waitForSelector('text=Error: expect(received).toEqual(expected)')
    },
  },
  jest: {
    entrypoint: 'report/jest_html_reporters.html',
    handler: async page => {
      await page.locator('[data-row-key*="adding.test.js"] [aria-label="Expand row"]').click()
      await page.waitForSelector('.ant-table-cell:has-text("Passed")')
      await page.waitForSelector('.ant-table-cell:has-text("Failed")')
    },
    screenshotOptions: {fullPage: true},
  },
  mocha: {
    entrypoint: 'output.html',
    handler: async page => {
      await page.waitForSelector('text=AssertionError [ERR_ASSERTION]: Expected values to be strictly equal')
    },
  },
  pytest: {
    entrypoint: 'report/index.html',
    handler: async page => {
      await page.waitForSelector('text=test.py:14: AssertionError')
    },
  },
  go: {
    entrypoint: 'test_report.html',
    handler: async page => {
      await page.click('.testResultGroup.failed')
      await page.click('.testGroupRow.failed')
      await page.waitForSelector('text=Result was incorrect')
    },
  },
  eslint: {
    entrypoint: '.eslint-config-inspector',
    handler: async page => {
      await page.click('text=eslint/defaults/ignores')
      await page.waitForSelector('text=Ignore files globally')
    },
  },
  website: {
    entrypoint: 'demosite/dist/index.html',
    handler: async page => {
      await page.waitForSelector('text=Welcome to Starlight')
    },
  },
  pdf: {
    entrypoint: 'output.pdf',
    handler: async page => {
      await page.locator('embed').waitFor()
      await setTimeout(1000)
    },
    screenshotOptions: {
      clip: {x: 0, y: 0, width: 650, height: 350},
    },
  },
}

Object.entries(handlers).forEach(([name, {entrypoint, handler, screenshotOptions}]) => {
  test(`take ${name} screenshot`, async ({page}) => {
    await page.goto(`${process.env.BASE_URL}/${name}/${entrypoint}`)
    await handler(page)
    await writeFile(`public/reports/${name}.png`, await page.screenshot(screenshotOptions))
  })
})
