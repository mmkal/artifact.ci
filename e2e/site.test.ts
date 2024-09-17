import {expect, test} from '@playwright/test'

test('homepage', async ({page}) => {
  await page.goto('/')
  await expect(page).toHaveTitle('artifact.ci')
})

test('debug endpoint', async ({page}) => {
  await page.goto('/api/debug')
  expect(await page.textContent('body')).toEqual('')
})
