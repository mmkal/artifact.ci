import assert from 'node:assert/strict'
// eslint-disable-next-line vitest/no-import-node-test -- vitest tests exist in the repo, but vitest is not installed as a direct executable here.
import {test} from 'node:test'
import {toArtifactFileUrl} from './artifact-url'

void test('direct action file output uses the blob route', () => {
  const url = toArtifactFileUrl(
    'https://artifact.ci/artifact/view/mmkal/artifact.ci/sha/5da99a9/result',
    'badge.svg',
  )

  assert.equal(url, 'https://artifact.ci/artifact/blob/mmkal/artifact.ci/sha/5da99a9/result/badge.svg')
})

void test('direct action file output preserves nested entry paths', () => {
  const url = toArtifactFileUrl(
    'https://artifact.ci/artifact/view/mmkal/artifact.ci/branch/readable-actions-output/result',
    'reports/index.html',
  )

  assert.equal(
    url,
    'https://artifact.ci/artifact/blob/mmkal/artifact.ci/branch/readable-actions-output/result/reports/index.html',
  )
})

void test('direct action file output rejects unexpected artifact URLs', () => {
  assert.throws(
    () => toArtifactFileUrl('https://artifact.ci/artifact/blob/mmkal/artifact.ci/sha/5da99a9/result', 'badge.svg'),
    /artifact URL must start with \/artifact\/view\//,
  )
})
