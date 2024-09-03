import {Page, test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

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

const handlers = {
  //   jest: async page => {
  //     await page.click('text=jest_html_reporters.html')
  //     await page.getByLabel('Expand row').first().click()
  //   },
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
} satisfies Record<string, {entrypoint: string; handler: (page: Page) => Promise<void>}>

Object.entries(handlers).forEach(([name, {entrypoint, handler}]) => {
  test(`take ${name} screenshot`, async ({page}) => {
    await page.goto(`${process.env.BASE_URL}/${name}/${entrypoint}`)
    await handler(page)
    await writeFile(`public/reports/${name}.png`, await page.screenshot({}))
  })
})
