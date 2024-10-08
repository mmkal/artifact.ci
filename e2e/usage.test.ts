import {Page, test} from '@playwright/test'
import {installApp, uninstallApp} from './manage-app'

const editFile = async (
  page: Page,
  params: {path: string; type: () => Promise<void>; commitMessage: string; branchName: string | null},
) => {
  await page.goto('https://github.com/mmkal-bot/test-repo/blob/main/' + params.path)
  await page.getByLabel('Edit this file').click()
  await page.locator('file-attachment .cm-line').last().click()
  await params.type()
  await page.locator('text=Commit changes').click()

  await page.locator('#commit-message-input').waitFor()
  await page.keyboard.press('Meta+Backspace')
  await page.keyboard.type(params.commitMessage)
  if (params.branchName) {
    await page.locator('text=Create a new branch').click()
    await page.locator('#branch-name-input').fill(params.branchName)
  }
  await page.keyboard.press('Meta+Enter')
  await page.locator('text=sdiofjsdoijfsd').click()
}

test.skip('showcase', async ({page}) => {
  await page.goto('https://github.com/mmkal-bot/test-repo')
  await new Promise(resolve => setTimeout(resolve, 2000))
  await page.locator('data-testid="checks-status-badge-icon"').click()
  await new Promise(resolve => setTimeout(resolve, 3000))

  await installApp({page})

  await editFile(page, {
    path: 'artifact.ci-' + Date.now(),
    type: async () => {
      await page.keyboard.press('Backspace')
      const lines = [
        ' --reporter html', //
        '- uses: actions/upload-artifact@v4',
        'with:',
        'name: test-report',
        'path: html',
      ]
      for (const line of lines) {
        await page.keyboard.type(line)
        await page.keyboard.press('Enter')
      }
    },
    commitMessage: 'add artifact.ci',
    branchName: 'artifact-ci-' + Date.now(),
  })

  await uninstallApp({page})
})

test.skip('add multiply test', async ({page}) => {
  await editFile(page, {
    path: 'calculator.test.ts',
    type: async () => {
      await page.keyboard.type(
        [
          `test('multiply', () => {`, //
          `expect(multiply(3, 4)).toBe(12)`,
          `})`,
        ].join('\n'),
      )
    },
    commitMessage: 'add multiply test',
    branchName: 'multiply-test-' + Date.now(),
  })
})
