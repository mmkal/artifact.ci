import {expect, test} from '@playwright/test'

test('homepage', async ({page}) => {
  await page.goto('/')
  await expect(page).toHaveTitle('artifact.ci')
})

test('db test endpoint', async ({page}) => {
  await page.goto('/api/test')
  const body = await page.textContent('body')
  expect(JSON.parse(body!)).toEqual({testTableData: {id: 1, name: 'one'}})
})
