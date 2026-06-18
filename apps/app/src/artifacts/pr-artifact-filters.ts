export type PullRequestArtifactFilter = {type: 'branch' | 'sha'; value: string}

export type PullRequestForArtifactFilters = {
  head: {ref: string; sha: string}
}

export type PullRequestCommitForArtifactFilters = {
  sha: string
}

export type CheckRunForArtifactFilters = {
  status: string
}

export async function resolvePullRequestArtifactFilters(input: {
  pull: PullRequestForArtifactFilters
  listCommits(): Promise<PullRequestCommitForArtifactFilters[]>
  listCheckRunsForRef(ref: string): Promise<CheckRunForArtifactFilters[]>
  countArtifactsForSha(identifier: string): Promise<number>
}): Promise<PullRequestArtifactFilter[]> {
  const branchFilter: PullRequestArtifactFilter = {
    type: 'branch',
    value: input.pull.head.ref.replaceAll('/', '__'),
  }
  const headIdentifier = toShortSha(input.pull.head.sha)
  if ((await input.countArtifactsForSha(headIdentifier)) > 0) {
    return [branchFilter, {type: 'sha', value: headIdentifier}]
  }

  const commits = await input.listCommits()
  for (const commit of commits.slice().reverse()) {
    if (commit.sha === input.pull.head.sha) continue
    if (await hasPendingChecks(input, commit.sha)) continue
    const identifier = toShortSha(commit.sha)
    if ((await input.countArtifactsForSha(identifier)) > 0) {
      return [branchFilter, {type: 'sha', value: identifier}]
    }
  }

  return [branchFilter]
}

function toShortSha(sha: string) {
  return sha.slice(0, 7)
}

async function hasPendingChecks(
  input: Pick<Parameters<typeof resolvePullRequestArtifactFilters>[0], 'listCheckRunsForRef'>,
  sha: string,
) {
  const checkRuns = await input.listCheckRunsForRef(sha)
  return checkRuns.some(run => run.status !== 'completed')
}
