import {PathParams} from '@artifact/domain/artifact/path-params'
import {type Id} from '@artifact/domain/db/client'
import {createServerFn} from '@tanstack/react-start'

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
// still be imported from client route loaders without dragging octokit /
// better-auth into the browser bundle.
export const loadArtifactForBrowser = createServerFn({method: 'GET'})
  .inputValidator((input: PathParams) => PathParams.parse(input))
  .handler(async ({data: params}): Promise<LoadArtifactResult> => {
    const [
      {checkCanAccess, getCollaborationLevel},
      {getInstallationOctokit, lookupRepoInstallation},
      {resolveArtifactRequest},
      {getCurrentSession},
      {getDb, parseJsonStringArray},
    ] = await Promise.all([
      import('@artifact/domain/github/access'),
      import('@artifact/domain/github/installations'),
      import('@artifact/domain/artifact/resolve-artifact-request'),
      import('../auth/session'),
      import('../cloudflare-env'),
    ])

    const db = getDb()
    const session = await getCurrentSession()
    const githubLogin = session.user?.githubLogin ?? undefined

    const resolved = await resolveArtifactRequest(
      githubLogin,
      {...params, filepath: []},
      {
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

          // Repo is registered. From here on, every other 'missing.kind'
          // confirms the repo exists in our DB → confirms it exists on GitHub.
          // Gate on the user having read access to the repo on GitHub before
          // returning anything more specific than 'unknown'.
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
          // The stored installation_github_id is whichever App was used to
          // register the repo first (prod or dev). Both apps share this DB,
          // so we can't treat it as authoritative for "this" app. Look up
          // the live installation for our current App JWT; fall back to
          // the stored id if the lookup comes up empty (e.g. a repo that
          // only has one App installed).
          const liveInstallation = await lookupRepoInstallation(owner, repo).catch(() => null)
          const installationToUse = liveInstallation?.id ?? installationGithubId
          const octokit = await getInstallationOctokit(installationToUse)
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
        async findStoragePathname() {
          return null
        },
      },
    )

    return {githubLogin: githubLogin ?? null, resolved}
  })

export declare namespace queries {
  export interface ArtifactInfo extends Record<string, unknown> {
    installation_github_id: number
    artifact_id: Id<'artifacts'>
    visibility: string
    entries_json: string | null
  }
}
