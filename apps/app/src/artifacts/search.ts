import {createServerFn} from '@tanstack/react-start'
import {z} from 'zod'
import {resolvePullRequestArtifactFilters} from './pr-artifact-filters'

const SearchInput = z.object({
  owner: z.string().optional(),
  repo: z.string().optional(),
  aliasType: z.string().optional(),
  identifier: z.string().optional(),
  artifactName: z.string().optional(),
})

export interface RepoResult {
  owner: string
  repo: string
  installation_github_id: number
  artifact_count: number
}

export interface ArtifactResult {
  artifactId: string
  name: string
  label: string
  createdAt: string
  pathParams: Array<{owner: string; repo: string; aliasType: string; identifier: string; artifactName: string}>
}

export interface ListResponse<T> {
  code: 'ok' | 'not_logged_in' | 'no_access'
  results: T[]
  viewerLogin?: string
}

export const searchRepos = createServerFn({method: 'GET'})
  .inputValidator((input: z.input<typeof SearchInput>) => SearchInput.parse(input))
  .handler(async ({data: params}): Promise<ListResponse<RepoResult>> => {
    const [{getCurrentSession}, {getInstallationOctokit}, {checkCanAccess}, {getDb}] = await Promise.all([
      import('../auth/session'),
      import('@artifact/domain/github/installations'),
      import('@artifact/domain/github/access'),
      import('../cloudflare-env'),
    ])
    const db = getDb()
    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined
    if (!githubLogin) return {code: 'not_logged_in', results: []}

    const owner = params.owner || githubLogin
    const repo = params.repo || null
    const rows: RepoResult[] = await db.sql.all<RepoResult & Record<string, unknown>>`
      select
        r.owner,
        r.name as repo,
        gi.github_id as installation_github_id,
        (select count(1) from artifacts where repo_id = r.id) as artifact_count
      from repos r
      join github_installations gi on gi.id = r.installation_id
      where r.owner = ${owner}
        and (${repo} is null or r.name = ${repo})
      group by r.id, r.owner, r.name, gi.github_id
      order by r.owner, r.name
      limit 100
    `
    if (!rows.length) return {code: 'ok', results: [], viewerLogin: githubLogin}

    const octokit = await getInstallationOctokit(rows[0].installation_github_id)
    for (const repo of rows) {
      const canAccess = await checkCanAccess(
        octokit,
        {
          owner: repo.owner,
          repo: repo.repo,
          username: githubLogin,
          artifactId: '',
        },
        {db},
      )
      if (!canAccess.canAccess) return {code: 'no_access', results: [], viewerLogin: githubLogin}
    }
    return {code: 'ok', results: rows, viewerLogin: githubLogin}
  })

export const searchArtifacts = createServerFn({method: 'GET'})
  .inputValidator((input: z.input<typeof SearchInput>) => SearchInput.parse(input))
  .handler(async ({data: params}): Promise<ListResponse<ArtifactResult>> => {
    const [
      {getCurrentSession},
      {getInstallationOctokit, lookupRepoInstallation},
      {checkCanAccess, getCollaborationLevel},
      {getDb, parseJsonStringArray},
    ] = await Promise.all([
      import('../auth/session'),
      import('@artifact/domain/github/installations'),
      import('@artifact/domain/github/access'),
      import('../cloudflare-env'),
    ])
    const db = getDb()
    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined
    if (!githubLogin) return {code: 'not_logged_in', results: []}

    const owner = params.owner || githubLogin
    type Row = Record<string, unknown> & {
      artifact_id: string
      name: string
      owner: string
      repo: string
      installation_github_id: number
      aggregated_identifiers_json: string | null
      created_at: string
    }
    const repo = params.repo || null
    let aliasType = params.aliasType || null
    let identifier = params.identifier || null
    let additionalAliasType: string | null = null
    let additionalIdentifier: string | null = null
    const artifactName = params.artifactName || null
    if (aliasType === 'pr' && repo && identifier) {
      const pullNumber = Number(identifier)
      if (!Number.isInteger(pullNumber) || pullNumber < 1) {
        aliasType = 'branch'
        identifier = '__invalid_pr_number__'
      } else {
        const installation = await lookupRepoInstallation(owner, repo).catch(() => null)
        if (!installation) return {code: 'no_access', results: [], viewerLogin: githubLogin}
        const octokit = await getInstallationOctokit(installation.id)
        const level = await getCollaborationLevel(octokit, {owner, repo, username: githubLogin}).catch(() => 'none')
        if (level === 'none') return {code: 'no_access', results: [], viewerLogin: githubLogin}

        const pull = await octokit.rest.pulls
          .get({owner, repo, pull_number: pullNumber})
          .then(response => response.data)
          .catch(() => null)
        if (pull) {
          const filters = await resolvePullRequestArtifactFilters({
            pull,
            listCommits: async () => {
              const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
                owner,
                repo,
                pull_number: pullNumber,
                per_page: 100,
              })
              return commits.map(commit => ({sha: commit.sha}))
            },
            listCheckRunsForRef: async ref => {
              const response = await octokit.rest.checks.listForRef({owner, repo, ref, per_page: 100}).catch(() => null)
              return response ? response.data.check_runs.map(run => ({status: run.status})) : []
            },
            countArtifactsForSha: async shaIdentifier => {
              const rows = await db.sql.all<{artifact_count: number}>`
                select count(distinct a.id) as artifact_count
                from artifacts a
                join artifact_identifiers ai on ai.artifact_id = a.id
                join repos r on r.id = a.repo_id
                where r.owner = ${owner}
                  and r.name = ${repo}
                  and ai.type = 'sha'
                  and ai.value = ${shaIdentifier}
              `
              return Number(rows[0]?.artifact_count || 0)
            },
          }).catch(() => [{type: 'branch' as const, value: pull.head.ref.replaceAll('/', '__')}])
          const primaryFilter = filters[0]
          const shaFilter = filters.find(filter => filter.type === 'sha') || null
          aliasType = primaryFilter.type
          identifier = primaryFilter.value
          additionalAliasType = shaFilter?.type || null
          additionalIdentifier = shaFilter?.value || null
        } else {
          aliasType = 'branch'
          identifier = '__pull_request_not_found__'
        }
      }
    }
    const runIdentifierPrefix =
      aliasType === 'run' && identifier && !identifier.includes('.') ? `${identifier}.%` : null
    const rows = await db.sql.all<Row>`
      select
        a.id as artifact_id,
        a.name,
        r.owner,
        r.name as repo,
        gi.github_id as installation_github_id,
        (
          select json_group_array(ai.type || '/' || ai.value)
          from artifact_identifiers ai
          where ai.artifact_id = a.id
        ) as aggregated_identifiers_json,
        max(a.created_at) as created_at
      from artifacts a
      join artifact_identifiers matched_ai on matched_ai.artifact_id = a.id
      join repos r on r.id = a.repo_id
      join github_installations gi on gi.id = a.installation_id
      where r.owner = ${owner}
        and (${repo} is null or r.name = ${repo})
        and (
          ${aliasType} is null
          or (
            matched_ai.type = ${aliasType}
            and (
              ${identifier} is null
              or matched_ai.value = ${identifier}
              or (
                ${runIdentifierPrefix} is not null
                and matched_ai.type = 'run'
                and matched_ai.value like ${runIdentifierPrefix}
              )
            )
          )
          or (
            ${additionalAliasType} is not null
            and matched_ai.type = ${additionalAliasType}
            and matched_ai.value = ${additionalIdentifier}
          )
        )
        and (${artifactName} is null or a.name = ${artifactName})
      group by a.id, a.name, r.owner, r.name, gi.github_id
      order by max(a.created_at) desc, a.name
      limit 100
    `
    if (!rows.length) return {code: 'ok', results: [], viewerLogin: githubLogin}

    const octokit = await getInstallationOctokit(rows[0].installation_github_id)
    const seenRepos = new Set<string>()
    for (const row of rows) {
      const key = `${row.owner}/${row.repo}`
      if (seenRepos.has(key)) continue
      seenRepos.add(key)
      const canAccess = await checkCanAccess(
        octokit,
        {
          owner: row.owner,
          repo: row.repo,
          username: githubLogin,
          artifactId: row.artifact_id,
        },
        {db},
      )
      if (!canAccess.canAccess) return {code: 'no_access', results: [], viewerLogin: githubLogin}
    }

    const priority: Record<string, number> = {run: 0, sha: 1, commit: 1, branch: 2}
    const results: ArtifactResult[] = rows.map(a => ({
      artifactId: a.artifact_id,
      name: a.name,
      label: params.repo ? '' : `${a.owner}/${a.repo}`,
      createdAt: a.created_at,
      pathParams: parseJsonStringArray(a.aggregated_identifiers_json)
        .map(id => {
          const [aliasType, ...rest] = id.split('/')
          return {
            owner: a.owner,
            repo: a.repo,
            aliasType,
            identifier: rest.join('/'),
            artifactName: a.name,
          }
        })
        .sort((l, r) => (priority[l.aliasType] ?? Infinity) - (priority[r.aliasType] ?? Infinity)),
    }))
    return {code: 'ok', results, viewerLogin: githubLogin}
  })
