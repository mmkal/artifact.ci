import {expect, test} from 'vitest'
import {getWwwToApexRedirect} from './canonical-host'
import {getGithubUrlRedirect} from './github-url'
import {getLegacyArtifactFileRedirect} from './legacy-artifact-file'

test('redirects www browser pages to the apex host', () => {
  const response = getWwwToApexRedirect(
    new Request('https://www.artifact.ci/artifact/view/mmkal/sqlfu/run/1.1/site?x=1'),
  )

  expect(response).toMatchObject({status: 308})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/mmkal/sqlfu/run/1.1/site?x=1')
})

test('redirects www HEAD requests to the apex host', () => {
  const response = getWwwToApexRedirect(new Request('https://www.artifact.ci/recipes/testing/vitest', {method: 'HEAD'}))

  expect(response).toMatchObject({status: 308})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/recipes/testing/vitest')
})

test('does not redirect apex requests', () => {
  const response = getWwwToApexRedirect(new Request('https://artifact.ci/artifact/view/mmkal/sqlfu/run/1.1/site'))

  expect(response).toBe(null)
})

test('does not redirect webhook and API endpoints on www', () => {
  const webhookResponse = getWwwToApexRedirect(new Request('https://www.artifact.ci/github/events', {method: 'POST'}))
  const apiResponse = getWwwToApexRedirect(new Request('https://www.artifact.ci/api/trpc/artifacts.search'))

  expect(webhookResponse).toBe(null)
  expect(apiResponse).toBe(null)
})

test('does not redirect non-browser methods on www', () => {
  const response = getWwwToApexRedirect(
    new Request('https://www.artifact.ci/artifact/view/mmkal/sqlfu/run/1.1/site', {method: 'POST'}),
  )

  expect(response).toBe(null)
})

test('redirects GitHub Actions job URLs to run artifact lists', () => {
  const response = getGithubUrlRedirect(
    new Request(
      'https://artifact.ci/https://github.com/iterate/iterate/actions/runs/27769878301/job/82166627150?pr=1564',
    ),
  )

  expect(response).toMatchObject({status: 302})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/iterate/iterate/run/27769878301')
})

test('redirects GitHub Actions run URLs to run artifact lists', () => {
  const response = getGithubUrlRedirect(
    new Request('https://artifact.ci/https://github.com/iterate/iterate/actions/runs/27769878301'),
  )

  expect(response).toMatchObject({status: 302})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/iterate/iterate/run/27769878301')
})

test('redirects encoded GitHub Actions URLs to run artifact lists', () => {
  const response = getGithubUrlRedirect(
    new Request(
      'https://artifact.ci/https%3A%2F%2Fgithub.com%2Fiterate%2Fiterate%2Factions%2Fruns%2F27769878301%2Fjob%2F82166627150%3Fpr%3D1564',
    ),
  )

  expect(response).toMatchObject({status: 302})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/iterate/iterate/run/27769878301')
})

test('redirects partially encoded GitHub Actions index URLs to run artifact lists', () => {
  const response = getGithubUrlRedirect(
    new Request(
      'https://artifact.ci/https%3A/github.com/iterate/iterate/actions/runs/27769878301/job/82166627150/index.html?pr=1564',
    ),
  )

  expect(response).toMatchObject({status: 302})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/iterate/iterate/run/27769878301')
})

test('redirects GitHub pull request URLs to PR artifact lists', () => {
  const response = getGithubUrlRedirect(new Request('https://artifact.ci/https://github.com/iterate/iterate/pull/1564'))

  expect(response).toMatchObject({status: 302})
  expect(response?.headers.get('location')).toBe('https://artifact.ci/artifact/view/iterate/iterate/pr/1564')
})

test('does not redirect non-browser methods for GitHub URLs', () => {
  const response = getGithubUrlRedirect(
    new Request('https://artifact.ci/https://github.com/iterate/iterate/actions/runs/27769878301', {method: 'POST'}),
  )

  expect(response).toBe(null)
})

test('redirects legacy artifact file links from view to blob', () => {
  const response = getLegacyArtifactFileRedirect(
    new Request('https://artifact.ci/artifact/view/mmkal/artifact.ci/branch/main/result/badge.svg?raw=true'),
  )

  expect(response).toMatchObject({status: 308})
  expect(response?.headers.get('location')).toBe(
    'https://artifact.ci/artifact/blob/mmkal/artifact.ci/branch/main/result/badge.svg?raw=true',
  )
})

test('redirects legacy artifact file links without file extensions', () => {
  const response = getLegacyArtifactFileRedirect(
    new Request('https://artifact.ci/artifact/view/mmkal/sqlfu/run/24728275564.1/website/ui?demo=1'),
  )

  expect(response).toMatchObject({status: 308})
  expect(response?.headers.get('location')).toBe(
    'https://artifact.ci/artifact/blob/mmkal/sqlfu/run/24728275564.1/website/ui?demo=1',
  )
})

test('does not redirect artifact browser routes', () => {
  const response = getLegacyArtifactFileRedirect(
    new Request('https://artifact.ci/artifact/view/mmkal/artifact.ci/branch/main/result'),
  )

  expect(response).toBe(null)
})

test('does not redirect non-browser methods for legacy artifact file links', () => {
  const response = getLegacyArtifactFileRedirect(
    new Request('https://artifact.ci/artifact/view/mmkal/artifact.ci/branch/main/result/badge.svg', {method: 'POST'}),
  )

  expect(response).toBe(null)
})
