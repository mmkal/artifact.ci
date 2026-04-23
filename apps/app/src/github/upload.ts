import {Client} from 'pg'
import {fromError} from 'zod-validation-error'
import {AliasType, UploadRequest, UploadResponse} from '@artifact/domain/github/upload-types'
import {getInstallationOctokit, lookupRepoInstallation} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'

async function withPg<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({connectionString: process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING})
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end().catch(() => {})
  }
}

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
  console.log('[upload] step 6/7 vault.secrets insert')

  const origin = process.env.PUBLIC_DEV_URL || new URL(request.url).origin
  // Direct INSERT into vault.secrets fails on newer Supabase projects
  // ("permission denied for function _crypto_aead_det_noncegen") because
  // the on-insert trigger calls pgsodium internals our pooler role can't
  // execute. The documented API is vault.create_secret — it returns the
  // row id, so we re-fetch the ciphertext from vault.secrets to keep the
  // token format unchanged for consumers.
  const tokenRows = await withPg(async c => {
    const idRes = await c.query<{id: string}>(
      `select vault.create_secret($1) as id`,
      [owner],
    )
    const id = idRes.rows[0]!.id
    const secretRes = await c.query<{secret: string | null}>(
      `select secret from vault.secrets where id = $1`,
      [id],
    )
    return secretRes.rows
  })
  console.log('[upload] step 7/7 respond')
  const uploadToken = tokenRows[0]
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
 * Resolves the GitHub App installation for an owner/repo live, then upserts
 * matching github_installations and repos rows. Uses pg directly rather than
 * pgkit because pg-promise's client gets wedged in workerd after the first
 * INSERT.
 */
async function ensureInstallationAndRepo(owner: string, repo: string) {
  const installation = await lookupRepoInstallation(owner, repo).catch(error => {
    logger.warn({owner, repo, error: String(error)}, 'lookup installation via GitHub failed')
    return null
  })
  if (!installation) return null

  await withPg(async c => {
    await c.query(
      `insert into github_installations (github_id)
       values ($1)
       on conflict (github_id) do update set updated_at = current_timestamp`,
      [installation.id],
    )
    await c.query(
      `insert into repos (owner, name, installation_id)
       values ($1, $2, (select id from github_installations where github_id = $3))
       on conflict (owner, name) do update set
         installation_id = excluded.installation_id,
         updated_at = current_timestamp`,
      [owner, repo, installation.id],
    )
  })
  return {id: installation.id}
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

  return withPg(async c => {
    const artifactRes = await c.query<InsertArtifactRow>(
      `with repo as (select * from repos where owner = $1 and name = $2)
       insert into artifacts (repo_id, name, github_id, installation_id, visibility)
       select
         repo.id as repo_id,
         $3 as name,
         $4 as github_id,
         (select id from github_installations where github_id = $5) as installation_id,
         coalesce($6, repo.default_visibility) as visibility
       from repo
       on conflict (repo_id, name, github_id)
         do update set
           installation_id = excluded.installation_id,
           visibility = coalesce($6, artifacts.visibility),
           updated_at = excluded.updated_at
       returning *`,
      [owner, repo, a.name, a.id, installation.id, a.visibility || null],
    )
    const dbArtifact = artifactRes.rows[0]

    const payload = identifiers.map(i => ({artifact_id: dbArtifact.id, type: i.type, value: i.value}))
    const identifierRes = await c.query<InsertIdentifierRow>(
      `insert into artifact_identifiers (artifact_id, type, value)
       select artifact_id, type, value
       from jsonb_populate_recordset(null::artifact_identifiers, $1::jsonb)
       on conflict (artifact_id, type, value) do update set updated_at = current_timestamp
       returning *`,
      [JSON.stringify(payload)],
    )

    return {dbArtifact, dbIdentifiers: identifierRes.rows}
  })
}
