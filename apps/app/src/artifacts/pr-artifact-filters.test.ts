import {expect, test} from 'vitest'
import {resolvePullRequestArtifactFilters} from './pr-artifact-filters'

test('includes the PR branch and head SHA when the head SHA has artifacts', async () => {
  const filters = await resolvePullRequestArtifactFilters({
    pull: pullRequest({branch: 'feature/add-url-handler', sha: sha('a')}),
    listCommits: async () => {
      throw new Error('commits should not be fetched when the head SHA has artifacts')
    },
    listCheckRunsForRef: async () => {
      throw new Error('checks should not be fetched when the head SHA has artifacts')
    },
    countArtifactsForSha: async identifier => (identifier === 'aaaaaaa' ? 2 : 0),
  })

  expect(filters).toMatchObject([
    {type: 'branch', value: 'feature__add-url-handler'},
    {type: 'sha', value: 'aaaaaaa'},
  ])
})

test('falls back to the newest older SHA with artifacts and no pending checks', async () => {
  const checkedRefs: string[] = []
  const countedShas: string[] = []

  const filters = await resolvePullRequestArtifactFilters({
    pull: pullRequest({branch: 'feature/add-url-handler', sha: sha('d')}),
    listCommits: async () => [{sha: sha('a')}, {sha: sha('b')}, {sha: sha('c')}, {sha: sha('d')}],
    listCheckRunsForRef: async ref => {
      checkedRefs.push(ref)
      return ref === sha('c') ? [{status: 'in_progress'}] : [{status: 'completed'}]
    },
    countArtifactsForSha: async identifier => {
      countedShas.push(identifier)
      return identifier === 'bbbbbbb' || identifier === 'ccccccc' ? 1 : 0
    },
  })

  expect(filters).toMatchObject([
    {type: 'branch', value: 'feature__add-url-handler'},
    {type: 'sha', value: 'bbbbbbb'},
  ])
  expect(checkedRefs).toEqual([sha('c'), sha('b')])
  expect(countedShas).toEqual(['ddddddd', 'bbbbbbb'])
})

test('returns only the PR branch when no complete SHA has artifacts', async () => {
  const filters = await resolvePullRequestArtifactFilters({
    pull: pullRequest({branch: 'feature/add-url-handler', sha: sha('c')}),
    listCommits: async () => [{sha: sha('a')}, {sha: sha('b')}, {sha: sha('c')}],
    listCheckRunsForRef: async () => [{status: 'completed'}],
    countArtifactsForSha: async () => 0,
  })

  expect(filters).toMatchObject([{type: 'branch', value: 'feature__add-url-handler'}])
})

function pullRequest(input: {branch: string; sha: string}) {
  return {
    head: {
      ref: input.branch,
      sha: input.sha,
    },
  }
}

function sha(character: string) {
  return character.repeat(40)
}
