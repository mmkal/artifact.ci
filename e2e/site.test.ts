import {expect, test} from '@playwright/test'

test('homepage', async ({request}) => {
  const response = await request.get('/')
  const html = await response.text()
  expect(response.ok()).toBe(true)
  expect(html).toContain('<title>artifact.ci</title>')
  expect(html).toContain('docs on Astro + Starlight')
})

test('login route shows app sign-in screen', async ({page}) => {
  await gotoWithRetry(page, '/login')
  await expect(page).toHaveTitle('artifact.ci')
  await expect(page.getByRole('heading', {name: 'Better Auth lands here next.'})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Sign in with GitHub'})).toBeVisible()
  await expect(page.getByText('GitHub OAuth via Better Auth')).toBeVisible()
})

async function gotoWithRetry(page: Parameters<typeof test>[0] extends never ? never : any, url: string) {
  let lastError: unknown

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url)
      if ((await page.title()) !== '502 - Bad Gateway') {
        return
      }
    } catch (error) {
      lastError = error
    }

    await page.waitForTimeout(1000)
  }

  if (lastError) throw lastError
}
