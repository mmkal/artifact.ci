import {fromError} from 'zod-validation-error'
import {client, sql, type Id} from '@artifact/domain/db/client'
import {AliasType, UploadRequest, UploadResponse} from '@artifact/domain/github/upload-types'
import {getInstallationOctokit, lookupRepoInstallation} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'

export async function handleUploadRequest(request: Request): Promise<Response> {
  const rawBody = (await request.json()) as {}

  const parsed = UploadRequest.safeParse(rawBody)
  if (!parsed.success) {
    const readable = fromError(parsed.error)
    logger.error({readable, body: rawBody})
    return Response.json({success: false, error: readable.message}, {status: 400})
  }

  const {owner, repo, ...event} = parsed.data

  const installation = await ensureInstallationAndRepo(owner, repo)
  if (!installation) {
    logger.warn({owner, repo}, `github installation not found`)
    return Response.json({success: false, error: `not found`}, {status: 404})
  }

  const octokit = await getInstallationOctokit(installation.id)

  const {data: workflowRun} = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: event.job.run_id,
  })

  if (workflowRun.status !== 'in_progress' && workflowRun.status !== 'queued') {
    logger.warn({workflowRun}, `workflow run is not in progress`)
    return Response.json({error: `not in progress`, status: workflowRun.status}, {status: 400})
  }

  const {data: githubArtifact} = await octokit.rest.actions.getArtifact({
    owner,
    repo,
    artifact_id: event.artifact.id,
  })

  const insertResult = await insertArtifactRecord({
    ...parsed.data,
    artifact: {...event.artifact, ...githubArtifact},
    installation,
  })

  const origin = new URL(request.url).origin
  const uploadToken = await client.one(sql<queries.Secret>`
    insert into vault.secrets (secret)
    values (${owner})
    returning secret
  `)
  const responseBody = UploadResponse.parse({
    success: true,
    urls: insertResult.dbIdentifiers.map(({type: aliasType, value: identifier}) => {
      const url = origin + toAppArtifactPath({owner, repo, aliasType, identifier, artifactName: githubArtifact.name})
      return {aliasType, url}
    }),
    artifactId: insertResult.dbArtifact.id,
    uploadToken: uploadToken.secret!,
  } satisfies UploadResponse)
  return Response.json(responseBody)
}

/**
 * Ensures a `github_installations` + `repos` row exist for the given
 * owner/repo and returns the installation (with GitHub's numeric id).
 *
 * In prod the webhook handler usually pre-populates these when the app
 * gets installed or a repo is added to an existing install. In dev,
 * and any time the `installation_repositories.added` webhook got
 * dropped, we just ask GitHub who owns this repo and upsert.
 */
async function ensureInstallationAndRepo(owner: string, repo: string) {
  // Always resolve against GitHub's live API rather than trusting the DB:
  // a stale repos row (e.g. from a prior run against a different app, or
  // a repo that got re-created under the same name) can otherwise send us
  // chasing an installation id that doesn't belong to this app.
  const installation = await lookupRepoInstallation(owner, repo).catch(error => {
    logger.warn({owner, repo, error: String(error)}, 'lookup installation via GitHub failed')
    return null
  })
  if (!installation) return null

  const installationGithubId = installation.id
  await client.query(sql<queries._void>`
    insert into github_installations (github_id)
    values (${installationGithubId})
    on conflict (github_id) do nothing
  `)
  await client.query(sql<queries._void>`
    insert into repos (owner, name, installation_id)
    values (
      ${owner},
      ${repo},
      (select id from github_installations where github_id = ${installationGithubId})
    )
    on conflict (owner, name) do update set
      installation_id = excluded.installation_id,
      updated_at = current_timestamp
  `)
  return {id: installationGithubId}
}

type InsertParams = UploadRequest & {
  artifact: {name: string; visibility?: 'private' | 'public'}
  installation: {id: number}
}

export const insertArtifactRecord = async ({owner, repo, job, artifact: a, installation}: InsertParams) => {
  return client.transaction(async tx => {
    const dbArtifact = await tx.one(sql<queries.Artifact>`
      with repo as (select * from repos where owner = ${owner} and name = ${repo})
      insert into artifacts (repo_id, name, github_id, installation_id, visibility)
      select
        repo.id as repo_id,
        ${a.name} as name,
        ${a.id} as github_id,
        (select id from github_installations where github_id = ${installation.id}) as installation_id,
        coalesce(${a.visibility || null}, repo.default_visibility) as visibility
      from repo
      on conflict (repo_id, name, github_id)
        do update set
          installation_id = excluded.installation_id,
          visibility = coalesce(${a.visibility || null}, artifacts.visibility),
          updated_at = excluded.updated_at
      returning *
    `)

    const dbIdentifiers = await tx.many(sql<queries.ArtifactIdentifier>`
      insert into artifact_identifiers (artifact_id, type, value)
      select artifact_id, type, value
      from jsonb_populate_recordset(
        null::artifact_identifiers,
        ${JSON.stringify(
          [
            {artifact_id: dbArtifact.id, type: 'run', value: `${job.run_id}.${job.run_attempt}`},
            {artifact_id: dbArtifact.id, type: 'sha', value: job.head_sha.slice(0, 7)},
            {artifact_id: dbArtifact.id, type: 'branch', value: job.head_branch.replaceAll('/', '__')},
          ].filter(type => a.aliasTypes.includes(type.type as AliasType)),
        )}
      )
      on conflict (artifact_id, type, value)
      do update set updated_at = current_timestamp
      returning *
    `)
    return {dbArtifact, dbIdentifiers}
  })
}

export declare namespace queries {
  export interface Installation {
    id: number
  }

  export interface Secret {
    secret: string | null
  }

  export interface Artifact {
    id: Id<'artifacts'>
    repo_id: string
    name: string
    created_at: Date
    updated_at: Date
    download_url: string | null
    github_id: number
    installation_id: string
    visibility: string
  }

  export interface ArtifactIdentifier {
    id: Id<'artifact_identifiers'>
    artifact_id: string
    type: string
    value: string
    created_at: Date
    updated_at: Date
  }

  export type _void = {}
}
