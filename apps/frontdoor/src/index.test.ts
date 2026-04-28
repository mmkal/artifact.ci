import {expect, test} from 'vitest'
import {getWwwToApexRedirect} from './canonical-host'

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
