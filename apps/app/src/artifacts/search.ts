import {createServerFn} from '@tanstack/react-start'
import {z} from 'zod'

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
    const [{getCurrentSession}, {getInstallationOctokit}, {checkCanAccess}, {getDb, parseJsonStringArray}] =
      await Promise.all([
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
    const aliasType = params.aliasType || null
    const identifier = params.identifier || null
    const artifactName = params.artifactName || null
    const rows = await db.sql.all<Row>`
      select
        a.id as artifact_id,
        a.name,
        r.owner,
        r.name as repo,
        gi.github_id as installation_github_id,
        json_group_array(ai.type || '/' || ai.value) as aggregated_identifiers_json,
        max(a.created_at) as created_at
      from artifacts a
      join artifact_identifiers ai on ai.artifact_id = a.id
      join repos r on r.id = a.repo_id
      join github_installations gi on gi.id = a.installation_id
      where r.owner = ${owner}
        and (${repo} is null or r.name = ${repo})
        and (${aliasType} is null or ai.type = ${aliasType})
        and (${identifier} is null or ai.value = ${identifier})
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
