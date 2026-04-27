import {createServerFn} from '@tanstack/react-start'
import {z} from 'zod'

/**
 * /artifact/view/* listing endpoints — direct ports of main's searchRepos /
 * searchArtifacts. Run as per-request fresh pg.Clients because the pool
 * wedge in workerd bites anything long-lived (same reason Better Auth and
 * the upload endpoint use fresh clients).
 *
 * Kept server-only: the handler bodies dynamic-import pg + domain deps so
 * this module is safe to import from route files that SSR in the worker
 * but also show up in the client bundle.
 */

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
    const [{Client}, {getCurrentSession}, {getInstallationOctokit}, {checkCanAccess}] = await Promise.all([
      import('pg'),
      import('../auth/session'),
      import('@artifact/domain/github/installations'),
      import('@artifact/domain/github/access'),
    ])
    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined
    if (!githubLogin) return {code: 'not_logged_in', results: []}

    const owner = params.owner || githubLogin
    const c = new Client({connectionString: process.env.DATABASE_URL})
    await c.connect()
    let rows: RepoResult[]
    try {
      const res = await c.query<RepoResult>(
        `select
           r.owner,
           r.name as repo,
           gi.github_id::int as installation_github_id,
           (select count(1)::int from artifacts where repo_id = r.id) as artifact_count
         from repos r
         join github_installations gi on gi.id = r.installation_id
         where r.owner = $1
           and ($2::text is null or r.name = $2)
         group by r.id, gi.github_id
         order by r.owner, r.name
         limit 100`,
        [owner, params.repo ?? null],
      )
      rows = res.rows
    } finally {
      await c.end().catch(() => {})
    }
    if (!rows.length) return {code: 'ok', results: [], viewerLogin: githubLogin}

    const octokit = await getInstallationOctokit(rows[0].installation_github_id)
    for (const repo of rows) {
      const canAccess = await checkCanAccess(octokit, {
        owner: repo.owner,
        repo: repo.repo,
        username: githubLogin,
        artifactId: '',
      })
      if (!canAccess.canAccess) return {code: 'no_access', results: [], viewerLogin: githubLogin}
    }
    return {code: 'ok', results: rows, viewerLogin: githubLogin}
  })

export const searchArtifacts = createServerFn({method: 'GET'})
  .inputValidator((input: z.input<typeof SearchInput>) => SearchInput.parse(input))
  .handler(async ({data: params}): Promise<ListResponse<ArtifactResult>> => {
    const [{Client}, {getCurrentSession}, {getInstallationOctokit}, {checkCanAccess}] = await Promise.all([
      import('pg'),
      import('../auth/session'),
      import('@artifact/domain/github/installations'),
      import('@artifact/domain/github/access'),
    ])
    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined
    if (!githubLogin) return {code: 'not_logged_in', results: []}

    const owner = params.owner || githubLogin
    type Row = {
      artifact_id: string
      name: string
      owner: string
      repo: string
      installation_github_id: number
      aggregated_identifiers: string[]
      created_at: string
    }
    const c = new Client({connectionString: process.env.DATABASE_URL})
    await c.connect()
    let rows: Row[]
    try {
      const res = await c.query<Row>(
        `select
           a.id as artifact_id,
           a.name,
           r.owner,
           r.name as repo,
           gi.github_id::int as installation_github_id,
           array_agg(ai.type || '/' || ai.value) as aggregated_identifiers,
           max(a.created_at)::text as created_at
         from artifacts a
         join artifact_identifiers ai on ai.artifact_id = a.id
         join repos r on r.id = a.repo_id
         join github_installations gi on gi.id = a.installation_id
         where r.owner = $1
           and ($2::text is null or r.name = $2)
           and ($3::text is null or ai.type = $3)
           and ($4::text is null or ai.value = $4)
           and ($5::text is null or a.name = $5)
         group by a.id, a.name, r.owner, r.name, gi.github_id
         order by max(a.created_at) desc, a.name
         limit 100`,
        [owner, params.repo ?? null, params.aliasType ?? null, params.identifier ?? null, params.artifactName ?? null],
      )
      rows = res.rows
    } finally {
      await c.end().catch(() => {})
    }
    if (!rows.length) return {code: 'ok', results: [], viewerLogin: githubLogin}

    const octokit = await getInstallationOctokit(rows[0].installation_github_id)
    const seenRepos = new Set<string>()
    for (const row of rows) {
      const key = `${row.owner}/${row.repo}`
      if (seenRepos.has(key)) continue
      seenRepos.add(key)
      const canAccess = await checkCanAccess(octokit, {
        owner: row.owner,
        repo: row.repo,
        username: githubLogin,
        artifactId: row.artifact_id,
      })
      if (!canAccess.canAccess) return {code: 'no_access', results: [], viewerLogin: githubLogin}
    }

    const priority: Record<string, number> = {run: 0, sha: 1, commit: 1, branch: 2}
    const results: ArtifactResult[] = rows.map(a => ({
      artifactId: a.artifact_id,
      name: a.name,
      label: params.repo ? '' : `${a.owner}/${a.repo}`,
      createdAt: a.created_at,
      pathParams: (a.aggregated_identifiers || [])
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
