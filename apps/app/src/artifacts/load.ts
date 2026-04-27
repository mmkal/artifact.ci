import {createServerFn} from '@tanstack/react-start'
import {PathParams} from '@artifact/domain/artifact/path-params'
import {type Id} from '@artifact/domain/db/client'

export interface ArtifactLoadedArtifactInfo {
  installationGithubId: number
  artifactId: string
  visibility: string
  entries: string[] | null
}

export type LoadArtifactResult = {
  githubLogin: string | null
  resolved: import('@artifact/domain/artifact/resolve-artifact-request').ResolveArtifactRequestResult
}

// Everything server-only goes behind a dynamic import so the module can
// still be imported from client route loaders without dragging pg /
// octokit / better-auth into the browser bundle.
export const loadArtifactForBrowser = createServerFn({method: 'GET'})
  .inputValidator((input: PathParams) => PathParams.parse(input))
  .handler(async ({data: params}): Promise<LoadArtifactResult> => {
    const [{Client}, {checkCanAccess}, {getInstallationOctokit, lookupRepoInstallation}, {resolveArtifactRequest}, {getCurrentSession}] =
      await Promise.all([
        import('pg'),
        import('@artifact/domain/github/access'),
        import('@artifact/domain/github/installations'),
        import('@artifact/domain/artifact/resolve-artifact-request'),
        import('../auth/session'),
      ])

    const withPg = async <T,>(fn: (c: InstanceType<typeof Client>) => Promise<T>): Promise<T> => {
      const c = new Client({connectionString: process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING})
      await c.connect()
      try {
        return await fn(c)
      } finally {
        await c.end().catch(() => {})
      }
    }

    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined

    const resolved = await resolveArtifactRequest(githubLogin, {...params, filepath: []}, {
      async findArtifactInfo({owner, repo, aliasType, identifier, artifactName}) {
        const artifactInfo = await withPg(async c => {
          const {rows} = await c.query<queries.ArtifactInfo>(
            `select
               i.github_id as installation_github_id,
               a.id as artifact_id,
               a.visibility,
               (select array_agg(entry_name) from artifact_entries ae where ae.artifact_id = a.id) as entries
             from artifacts a
             join artifact_identifiers aid on aid.artifact_id = a.id
             join github_installations i on i.id = a.installation_id
             join repos r on r.id = a.repo_id
             where a.name = $1
               and aid.type = $2
               and aid.value = $3
               and r.owner = $4
               and r.name = $5
             order by a.created_at desc
             limit 1`,
            [artifactName, aliasType, identifier, owner, repo],
          )
          return rows[0] ?? null
        })

        if (!artifactInfo) return null

        return {
          installationGithubId: artifactInfo.installation_github_id,
          artifactId: artifactInfo.artifact_id,
          visibility: artifactInfo.visibility,
          entries: artifactInfo.entries,
        }
      },
      async checkAccess({installationGithubId, artifactId, owner, repo, githubLogin}) {
        // The stored installation_github_id is whichever App was used to
        // register the repo first (prod or dev). Both apps share this DB,
        // so we can't treat it as authoritative for "this" app. Look up
        // the live installation for our current App JWT; fall back to
        // the stored id if the lookup comes up empty (e.g. a repo that
        // only has one App installed).
        const liveInstallation = await lookupRepoInstallation(owner, repo).catch(() => null)
        const installationToUse = liveInstallation?.id ?? installationGithubId
        const octokit = await getInstallationOctokit(installationToUse)
        return checkCanAccess(octokit, {
          owner,
          repo,
          username: githubLogin,
          artifactId,
        })
      },
      async findStoragePathname() {
        return null
      },
    })

    return {githubLogin: githubLogin ?? null, resolved}
  })

export declare namespace queries {
  export interface ArtifactInfo {
    installation_github_id: number
    artifact_id: Id<'artifacts'>
    visibility: string
    entries: string[] | null
  }
}
