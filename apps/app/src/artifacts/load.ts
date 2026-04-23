import {createServerFn} from '@tanstack/react-start'
import {PathParams} from '@artifact/domain/artifact/path-params'
import {client, sql, type Id} from '@artifact/domain/db/client'
import {checkCanAccess} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {resolveArtifactRequest} from '@artifact/domain/artifact/resolve-artifact-request'
import {getCurrentSession} from '../auth/session'

export type LoadArtifactResult = Awaited<ReturnType<typeof loadArtifactInner>>

export const loadArtifactForBrowser = createServerFn({method: 'GET'})
  .inputValidator((input: PathParams) => PathParams.parse(input))
  .handler(async ({data: params}) => loadArtifactInner(params))

async function loadArtifactInner(params: PathParams) {
  const session = await getCurrentSession()
  const githubLogin = session.user?.githubLogin ?? undefined

  const resolved = await resolveArtifactRequest(githubLogin, {...params, filepath: []}, {
    async findArtifactInfo({owner, repo, aliasType, identifier, artifactName}) {
      const artifactInfo = await client.maybeOne(sql<queries.ArtifactInfo>`
        select
          i.github_id as installation_github_id,
          a.id as artifact_id,
          a.visibility,
          (select array_agg(entry_name) from artifact_entries ae where ae.artifact_id = a.id) entries
        from artifacts a
        join artifact_identifiers aid on aid.artifact_id = a.id
        join github_installations i on i.id = a.installation_id
        join repos r on r.id = a.repo_id
        where a.name = ${artifactName}
        and aid.type = ${aliasType}
        and aid.value = ${identifier}
        and r.owner = ${owner}
        and r.name = ${repo}
        order by a.created_at desc
        limit 1
      `)

      if (!artifactInfo) return null

      return {
        installationGithubId: artifactInfo.installation_github_id,
        artifactId: artifactInfo.artifact_id,
        visibility: artifactInfo.visibility,
        entries: artifactInfo.entries,
      }
    },
    async checkAccess({installationGithubId, artifactId, owner, repo, githubLogin}) {
      const octokit = await getInstallationOctokit(installationGithubId)
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
}

export declare namespace queries {
  export interface ArtifactInfo {
    installation_github_id: number
    artifact_id: Id<'artifacts'>
    visibility: string
    entries: string[] | null
  }
}
