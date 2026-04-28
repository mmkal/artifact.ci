import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {createPrefixedId} from '@artifact/domain/db/client'
import {getInstallationOctokit, lookupRepoInstallation} from '@artifact/domain/github/installations'
import {AliasType, UploadRequest, UploadResponse} from '@artifact/domain/github/upload-types'
import {logger} from '@artifact/domain/logging/tag-logger'
import {fromError} from 'zod-validation-error'
import {getAppEnv, getDb} from '../cloudflare-env'
import {createUploadToken} from '../upload-tokens'
import {getArtifactOrigin} from './origin'

export async function handleUploadRequest(request: Request): Promise<Response> {
  try {
    return await handleUploadRequestInner(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[upload] unhandled error', {error: message})
    return Response.json({success: false, error: message}, {status: 500})
  }
}

async function handleUploadRequestInner(request: Request): Promise<Response> {
  const rawBody = (await request.json()) as {}

  const parsed = UploadRequest.safeParse(rawBody)
  if (!parsed.success) {
    const readable = fromError(parsed.error)
    logger.error({readable, body: rawBody})
    return Response.json({success: false, error: readable.message}, {status: 400})
  }

  const {owner, repo, ...event} = parsed.data

  console.log('[upload] step 1/7 ensureInstallationAndRepo')
  const installation = await ensureInstallationAndRepo(owner, repo)
  if (!installation) {
    logger.warn({owner, repo}, `github installation not found`)
    return Response.json({success: false, error: `not found`}, {status: 404})
  }

  console.log('[upload] step 2/7 getInstallationOctokit', installation.id)
  const octokit = await getInstallationOctokit(installation.id)

  console.log('[upload] step 3/7 getWorkflowRun', event.job.run_id)
  const {data: workflowRun} = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: event.job.run_id,
  })
  console.log('[upload] workflow status', workflowRun.status)

  if (workflowRun.status !== 'in_progress' && workflowRun.status !== 'queued') {
    logger.warn({workflowRun}, `workflow run is not in progress`)
    return Response.json({error: `not in progress`, status: workflowRun.status}, {status: 400})
  }

  console.log('[upload] step 4/7 getArtifact', event.artifact.id)
  const {data: githubArtifact} = await octokit.rest.actions.getArtifact({
    owner,
    repo,
    artifact_id: event.artifact.id,
  })
  console.log('[upload] got artifact name', githubArtifact.name)

  console.log('[upload] step 5/7 insertArtifactRecord')
  const insertResult = await insertArtifactRecord({
    ...parsed.data,
    artifact: {...event.artifact, ...githubArtifact},
    installation,
  })
  console.log('[upload] step 6/7 upload_tokens insert')

  const origin = getArtifactOrigin(request)
  const uploadToken = await createUploadToken(getDb(), owner)
  console.log('[upload] step 7/7 respond')
  const responseBody = UploadResponse.parse({
    success: true,
    urls: insertResult.dbIdentifiers.map(({type: aliasType, value: identifier}) => {
      const url = origin + toAppArtifactPath({owner, repo, aliasType, identifier, artifactName: githubArtifact.name})
      return {aliasType, url}
    }),
    artifactId: insertResult.dbArtifact.id,
    uploadToken,
  } satisfies UploadResponse)
  return Response.json(responseBody)
}

async function ensureInstallationAndRepo(owner: string, repo: string) {
  const installation = await lookupRepoInstallation(owner, repo).catch(error => {
    logger.warn({owner, repo, error: String(error)}, 'lookup installation via GitHub failed')
    return null
  })
  if (!installation) return null

  return storeInstallationAndRepo({owner, repo, installationId: installation.id})
}

export async function storeInstallationAndRepo({
  owner,
  repo,
  installationId,
}: {
  owner: string
  repo: string
  installationId: number
}) {
  const db = getDb()
  const installationRows = await db.sql.all<{id: string}>`
    insert into github_installations (id, github_id, removed_at)
    values (${createPrefixedId('github_installation')}, ${installationId}, null)
    on conflict (github_id) do update set
      removed_at = null,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    returning id
  `
  const dbInstallationId = installationRows[0]?.id
  if (!dbInstallationId) throw new Error(`github installation ${installationId} was not stored`)

  const repoRows = await db.sql.all<{id: string; owner: string; name: string; installation_id: string}>`
    insert into repos (id, owner, name, installation_id)
    values (${createPrefixedId('repo')}, ${owner}, ${repo}, ${dbInstallationId})
    on conflict (owner, name) do update set
      installation_id = excluded.installation_id,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    returning id, owner, name, installation_id
  `
  return {id: installationId, dbInstallationId, dbRepo: repoRows[0]}
}

type InsertParams = UploadRequest & {
  artifact: {name: string; visibility?: 'private' | 'public'}
  installation: {id: number}
}

export type InsertArtifactRow = {
  id: string
  repo_id: string
  name: string
  github_id: number
  installation_id: string
  visibility: string
}

export type InsertIdentifierRow = {
  id: string
  artifact_id: string
  type: string
  value: string
}

export const insertArtifactRecord = async ({
  owner,
  repo,
  job,
  artifact: a,
  installation,
}: InsertParams): Promise<{dbArtifact: InsertArtifactRow; dbIdentifiers: InsertIdentifierRow[]}> => {
  const identifiers = [
    {type: 'run', value: `${job.run_id}.${job.run_attempt}`},
    {type: 'sha', value: job.head_sha.slice(0, 7)},
    {type: 'branch', value: job.head_branch.replaceAll('/', '__')},
  ].filter(x => a.aliasTypes.includes(x.type as AliasType))

  const db = getDb()
  const repoRows = await db.sql.all<{repo_id: string; default_visibility: string; installation_id: string}>`
    select r.id as repo_id, r.default_visibility, gi.id as installation_id
    from repos r
    join github_installations gi on gi.github_id = ${installation.id}
    where r.owner = ${owner}
      and r.name = ${repo}
    limit 1
  `
  const dbRepo = repoRows[0]
  if (!dbRepo) throw new Error(`repo ${owner}/${repo} was not stored before artifact insert`)

  const existingArtifactRows = await db.sql.all<{id: string}>`
    select id
    from artifacts
    where repo_id = ${dbRepo.repo_id}
      and name = ${a.name}
      and github_id = ${a.id}
    limit 1
  `
  const artifactId = existingArtifactRows[0]?.id || createPrefixedId('artifact')
  const visibility = a.visibility || dbRepo.default_visibility
  const artifactVisibilityOverride = a.visibility || null
  const d1 = getAppEnv().ARTIFACT_DB
  const statements = [
    d1
      .prepare(
        `
          insert into artifacts (id, repo_id, name, github_id, installation_id, visibility)
          values (?, ?, ?, ?, ?, ?)
          on conflict (repo_id, name, github_id) do update set
            installation_id = excluded.installation_id,
            visibility = coalesce(?, artifacts.visibility),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          returning id, repo_id, name, github_id, installation_id, visibility
        `,
      )
      .bind(artifactId, dbRepo.repo_id, a.name, a.id, dbRepo.installation_id, visibility, artifactVisibilityOverride),
    ...identifiers.map(identifier =>
      d1
        .prepare(
          `
            insert into artifact_identifiers (id, artifact_id, type, value)
            values (?, (select id from artifacts where repo_id = ? and name = ? and github_id = ?), ?, ?)
            on conflict (artifact_id, type, value) do update set
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            returning id, artifact_id, type, value
          `,
        )
        .bind(createPrefixedId('artifact_identifier'), dbRepo.repo_id, a.name, a.id, identifier.type, identifier.value),
    ),
  ]
  const results = await d1.batch(statements)
  const dbArtifact = results[0]?.results[0] as InsertArtifactRow | undefined
  if (!dbArtifact) throw new Error(`artifact ${a.id} was not stored`)
  const dbIdentifiers = results.slice(1).flatMap(result => result.results as InsertIdentifierRow[])

  return {dbArtifact, dbIdentifiers}
}
