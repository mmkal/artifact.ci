import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resolveFilepath, type Resolution} from './resolve-filepath'

const fixtureEntries = new Set([
  'landing.html',
  'docs.html',
  'docs/overview.html',
  'docs/api.html',
  'ui.html',
  'ui/assets/main.js',
  'ui/assets/main.css',
  'about/index.html',
  'team/index.html',
  'team/about.html',
])

const cases: Array<{name: string; filepath: string; trailingSlash: boolean; expected: Resolution}> = [
  {name: '/landing', filepath: 'landing', trailingSlash: false, expected: {type: 'serve', entryName: 'landing.html'}},
  {name: '/landing/', filepath: 'landing', trailingSlash: true, expected: {type: 'redirect', filepath: 'landing', trailingSlash: false}},
  {name: '/landing.html', filepath: 'landing.html', trailingSlash: false, expected: {type: 'serve', entryName: 'landing.html'}},
  {name: '/docs', filepath: 'docs', trailingSlash: false, expected: {type: 'serve', entryName: 'docs.html'}},
  {name: '/docs/', filepath: 'docs', trailingSlash: true, expected: {type: 'redirect', filepath: 'docs', trailingSlash: false}},
  {name: '/docs/overview', filepath: 'docs/overview', trailingSlash: false, expected: {type: 'serve', entryName: 'docs/overview.html'}},
  {name: '/docs/overview/', filepath: 'docs/overview', trailingSlash: true, expected: {type: 'redirect', filepath: 'docs/overview', trailingSlash: false}},
  {name: '/ui', filepath: 'ui', trailingSlash: false, expected: {type: 'serve', entryName: 'ui.html'}},
  {name: '/ui/', filepath: 'ui', trailingSlash: true, expected: {type: 'redirect', filepath: 'ui', trailingSlash: false}},
  {name: '/ui/assets/main.js', filepath: 'ui/assets/main.js', trailingSlash: false, expected: {type: 'serve', entryName: 'ui/assets/main.js'}},
  {name: '/about', filepath: 'about', trailingSlash: false, expected: {type: 'redirect', filepath: 'about', trailingSlash: true}},
  {name: '/about/', filepath: 'about', trailingSlash: true, expected: {type: 'serve', entryName: 'about/index.html'}},
  {name: '/team', filepath: 'team', trailingSlash: false, expected: {type: 'redirect', filepath: 'team', trailingSlash: true}},
  {name: '/team/about', filepath: 'team/about', trailingSlash: false, expected: {type: 'serve', entryName: 'team/about.html'}},
  {name: '/nope', filepath: 'nope', trailingSlash: false, expected: {type: 'not_found'}},
  {name: '/nope/', filepath: 'nope', trailingSlash: true, expected: {type: 'not_found'}},
]

for (const c of cases) {
  test(`resolve ${c.name}`, () => {
    const actual = resolveFilepath(c.filepath, c.trailingSlash, fixtureEntries)
    assert.deepEqual(actual, c.expected)
  })
}

test('foo/index.html wins over foo.html when both exist', () => {
  const entries = new Set(['conflict.html', 'conflict/index.html'])
  assert.deepEqual(
    resolveFilepath('conflict', false, entries),
    {type: 'redirect', filepath: 'conflict', trailingSlash: true},
  )
  assert.deepEqual(
    resolveFilepath('conflict', true, entries),
    {type: 'serve', entryName: 'conflict/index.html'},
  )
})
