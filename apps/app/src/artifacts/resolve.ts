import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import {PathParams, toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {resolveArtifactRequest} from '@artifact/domain/artifact/resolve-artifact-request'
import {type Id} from '@artifact/domain/db/client'
import {checkCanAccess, getCollaborationLevel} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {getDb, parseJsonStringArray} from '../cloudflare-env'

export async function resolveArtifactForEdge(
  input: ArtifactResolveRequest,
  githubLogin: string | undefined,
): Promise<ArtifactResolveResponse> {
  const params = PathParams.parse(input.params)
  const db = getDb()

  const resolved = await resolveArtifactRequest(githubLogin, params, {
    async findArtifactInfo({owner, repo, aliasType, identifier, artifactName}) {
      const rows = await db.sql.all<queries.ArtifactInfo>`
        select
          i.github_id as installation_github_id,
          a.id as artifact_id,
          a.visibility,
          coalesce((select json_group_array(entry_name) from artifact_entries ae where ae.artifact_id = a.id), '[]') as entries_json
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
      `
      const artifactInfo = rows[0] || null

      if (!artifactInfo) return null

      return {
        installationGithubId: artifactInfo.installation_github_id,
        artifactId: artifactInfo.artifact_id,
        visibility: artifactInfo.visibility,
        entries: parseJsonStringArray(artifactInfo.entries_json),
      }
    },
    async diagnoseMissingArtifact({owner, repo, aliasType, identifier, artifactName}, githubLogin) {
      const repoRows = await db.sql.all<{id: string; installation_github_id: number}>`
        select r.id as id, gi.github_id as installation_github_id
        from repos r
        join github_installations gi on gi.id = r.installation_id
        where r.owner = ${owner} and r.name = ${repo}
        limit 1
      `
      if (!repoRows[0]) return {kind: 'repo_not_registered', owner, repo}

      // Past this point every diagnostic confirms the repo exists in our DB →
      // confirms it exists on GitHub. Gate on the user having read access to
      // the repo on GitHub before returning anything more specific.
      if (!githubLogin) return {kind: 'unknown'}
      const octokit = await getInstallationOctokit(repoRows[0].installation_github_id).catch(() => null)
      if (!octokit) return {kind: 'unknown'}
      const level = await getCollaborationLevel(octokit, {owner, repo, username: githubLogin}).catch(() => 'none')
      if (level === 'none') return {kind: 'unknown'}

      const artifactRows = await db.sql.all<{id: string}>`
        select id from artifacts
        where repo_id = ${repoRows[0].id} and name = ${artifactName}
        order by created_at desc
        limit 1
      `
      if (!artifactRows[0]) return {kind: 'no_artifact_in_repo', owner, repo, artifactName}

      const idRows = await db.sql.all<{id: string}>`
        select id from artifact_identifiers
        where artifact_id = ${artifactRows[0].id}
          and type = ${aliasType}
          and value = ${identifier}
        limit 1
      `
      if (!idRows[0]) return {kind: 'no_identifier_for_artifact', owner, repo, artifactName, aliasType, identifier}

      return {kind: 'unknown'}
    },
    async checkAccess({installationGithubId, artifactId, owner, repo, githubLogin}) {
      const octokit = await getInstallationOctokit(installationGithubId)
      return checkCanAccess(
        octokit,
        {
          owner,
          repo,
          username: githubLogin,
          artifactId,
        },
        {db},
      )
    },
    async findStoragePathname({artifactId, entry}) {
      const rows = await db.sql.all<queries.DbFile>`
        select ae.storage_pathname
        from artifacts a
        join artifact_entries ae on ae.artifact_id = a.id
        where a.id = ${artifactId}
          and exists (
            select 1
            from json_each(ae.aliases)
            where json_each.value = ${entry}
          )
        order by ae.created_at desc
        limit 1
      `
      return rows[0]?.storage_pathname || null
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
  export interface ArtifactInfo extends Record<string, unknown> {
    installation_github_id: number
    artifact_id: Id<'artifacts'>
    visibility: string
    entries_json: string | null
  }

  export interface DbFile extends Record<string, unknown> {
    storage_pathname: string | null
  }
}
