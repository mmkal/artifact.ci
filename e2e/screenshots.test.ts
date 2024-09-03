import {test} from '@playwright/test'
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

test('take vitest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/vitest/vitest/html/index.html`)
  await page.hover('text=add badly')
  await page.getByLabel('add badly').getByTestId('btn-open-details').click()
  await page.click('text=Report')
  await page.waitForSelector('text=AssertionError')
  await writeFile('public/reports/vitest.png', await page.screenshot())
})

test('take playwright screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/playwright/playwright-report/index.html`)
  await page.click('text=add badly')
  await page.waitForSelector('text=Error: expect(received).toEqual(expected)')
  await writeFile('public/reports/playwright.png', await page.screenshot())
})

test('take jest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/jest/report/jest_html_reporters.html`)
  await page.locator('[data-row-key*="adding.test.js"] [aria-label="Expand row"]').click()
  await page.waitForSelector('.ant-table-cell:has-text("Passed")')
  await page.waitForSelector('.ant-table-cell:has-text("Failed")')
  await writeFile('public/reports/jest.png', await page.screenshot({fullPage: true}))
})

test('take mocha screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/mocha/output.html`)
  await page.waitForSelector('text=AssertionError [ERR_ASSERTION]: Expected values to be strictly equal')
  await writeFile('public/reports/mocha.png', await page.screenshot())
})

test('take ava screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/ava/output.html`)
  await page.waitForSelector('text=add badly')
  await writeFile('public/reports/ava.png', await page.screenshot())
})

test('take pytest screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/pytest/report/index.html`)
  await page.waitForSelector('text=test.py:14: AssertionError')
  await writeFile('public/reports/pytest.png', await page.screenshot())
})

test('take go screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/go/test_report.html`)
  await page.click('.testResultGroup.failed')
  await page.click('.testGroupRow.failed')
  await page.waitForSelector('text=Result was incorrect')
  await writeFile('public/reports/go.png', await page.screenshot())
})

test('take eslint screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/eslint/.eslint-config-inspector`)
  await page.click('text=eslint/defaults/ignores')
  await page.waitForSelector('text=Ignore files globally')
  await writeFile('public/reports/eslint.png', await page.screenshot())
})

test('take website screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/website/demosite/dist/index.html`)
  await page.waitForSelector('text=Welcome to Starlight')
  await writeFile('public/reports/website.png', await page.screenshot())
})

test('take pdf screenshot', async ({page}) => {
  await page.goto(`${process.env.BASE_URL}/pdf/output.pdf`)
  await page.locator('embed').waitFor()
  await setTimeout(1000) // I don't think you can really test pdfs with playwright
  await writeFile(
    'public/reports/pdf.png',
    await page.screenshot({
      clip: {x: 0, y: 0, width: 650, height: 350},
    }),
  )
})
