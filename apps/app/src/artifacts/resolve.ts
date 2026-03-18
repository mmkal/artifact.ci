import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import {PathParams, toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {resolveArtifactRequest} from '@artifact/domain/artifact/resolve-artifact-request'
import {checkCanAccess, getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'

export async function resolveArtifactForEdge(
  input: ArtifactResolveRequest,
  githubLogin: string | undefined,
): Promise<ArtifactResolveResponse> {
  const params = PathParams.parse(input.params)

  const resolved = await resolveArtifactRequest(githubLogin, params, {
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
    async findStoragePathname({artifactId, entry}) {
      const dbFile = await client.maybeOne(sql<queries.DbFile>`
        select o.name as storage_pathname
        from artifacts a
        join artifact_entries ae on ae.artifact_id = a.id
        join storage.objects o on ae.storage_object_id = o.id
        where a.id = ${artifactId}
        and ${entry} = any(ae.aliases)
        and o.name is not null
        order by ae.created_at desc
        limit 1
      `)

      return dbFile?.storage_pathname || null
    },
  })

  if (resolved.code === 'not_authorized' && !resolved.githubLogin) {
    return {
      kind: 'redirect',
      location: `/login?${new URLSearchParams({callbackUrl: input.requestPathname})}`,
      status: 302,
    }
  }

  if (resolved.code === 'not_uploaded_yet') {
    return {
      kind: 'redirect',
      location: `${toAppArtifactPath(params)}?reload=true`,
      status: 307,
    }
  }

  if (resolved.code === 'artifact_not_found' || resolved.code === 'upload_not_found') {
    return {
      kind: 'json',
      status: 404,
      body: resolved,
    }
  }

  if (resolved.code === 'not_authorized') {
    return {
      kind: 'json',
      status: 403,
      body: resolved,
    }
  }

  if (!resolved.storagePathname) {
    return {
      kind: 'redirect',
      location: toAppArtifactPath(params),
      status: 307,
    }
  }

  return {
    kind: 'serve-file',
    storagePathname: resolved.storagePathname,
    params,
    raw: input.raw,
  }
}

export declare namespace queries {
  export interface ArtifactInfo {
    installation_github_id: number
    artifact_id: import('~/db').Id<'artifacts'>
    visibility: string
    entries: string[] | null
  }

  export interface DbFile {
    storage_pathname: string | null
  }
}
