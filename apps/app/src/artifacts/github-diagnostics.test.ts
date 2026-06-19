import {expect, test} from 'vitest'
import {summarizeUploadArtifactLog} from './github-log-diagnostics'

test('summarizes upload-artifact log output with empty path warnings', () => {
  const summary = summarizeUploadArtifactLog(`
    2026-06-19T10:00:00.000Z ##[group]Run actions/upload-artifact@v4
    2026-06-19T10:00:01.000Z With the provided path, there will be 0 files uploaded
    2026-06-19T10:00:02.000Z No files were found with the provided path: test-results. No artifacts will be uploaded.
    2026-06-19T10:00:03.000Z ##[endgroup]
  `)

  expect(summary).toMatchObject({
    hasUploadArtifactStep: true,
    hasEmptyUpload: true,
    messages: [
      '##[group]Run actions/upload-artifact@v4',
      'With the provided path, there will be 0 files uploaded',
      'No files were found with the provided path: test-results. No artifacts will be uploaded.',
    ],
  })
})

test('summarizes logs without upload-artifact steps', () => {
  const summary = summarizeUploadArtifactLog('Run pnpm test\nAll tests passed')

  expect(summary).toMatchObject({
    hasUploadArtifactStep: false,
    hasEmptyUpload: false,
    messages: [],
  })
})
