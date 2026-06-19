import {getEntrypoints} from '@artifact/domain/artifact/entrypoints'
import {Id, createPrefixedId} from '@artifact/domain/db/client'
import {checkCanAccess} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {initTRPC, TRPCError} from '@trpc/server'
import {AwsClient} from 'aws4fetch'
import mime from 'mime'
import pMap from 'p-suite/p-map'
import {z} from 'zod'
import {ArtifactDiagnosticInput, diagnoseArtifactRequest} from '../artifacts/github-diagnostics'
import {getAppEnv, getDb, parseJsonStringArray, type AppEnv} from '../cloudflare-env'
import {lookupUploadToken} from '../upload-tokens'

export interface TrpcContext {
  githubLogin: string | null | undefined
  getHeader: (name: string) => string | null | undefined
}

interface ArtifactRow extends Record<string, unknown> {
  id: string
  repo_id: string
  name: string
  created_at: string
  updated_at: string
  github_id: number
  installation_id: string
  visibility: string
  installation_github_id: number
  owner: string
  repo: string
}

const unmodifiedTRPC = initTRPC.context<TrpcContext>().create()

export const router = unmodifiedTRPC.router
export const publicProcedure = unmodifiedTRPC.procedure.use(async function loggingMiddleware({ctx, next, path}) {
  const requestId = crypto.randomUUID()
  return logger.run([`path=${path}`, `requestId=${requestId}`], () => next({ctx}))
})

export const artifactAccessProcedure = unmodifiedTRPC.procedure
  .input(z.object({artifactId: Id('artifact')}))
  .use(async ({input, ctx, next}) => {
    const db = getDb()
    let githubLogin = ctx.githubLogin
    if (!githubLogin) {
      const uploadToken = ctx.getHeader('artifactci-upload-token')
      if (uploadToken) githubLogin = await lookupUploadToken(db, uploadToken)
    }
    if (!githubLogin) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'not authenticated'})
    }

    const artifactRows = await db.sql.all<ArtifactRow>`
      select a.*, gi.github_id as installation_github_id, r.owner, r.name as repo
      from artifacts a
      join github_installations gi on gi.id = a.installation_id
      join repos r on r.id = a.repo_id
      where a.id = ${input.artifactId}
    `
    if (!artifactRows[0]) {
      throw new TRPCError({code: 'NOT_FOUND', message: `artifact ${input.artifactId} not found`})
    }
    const artifact = artifactRows[0]

    console.log('[trpc-mw] got artifact, install id:', artifact.installation_github_id)
    const octokit = await getInstallationOctokit(artifact.installation_github_id)
    console.log('[trpc-mw] got octokit')

    const canAccess = await checkCanAccess(
      octokit,
      {
        owner: artifact.owner,
        repo: artifact.repo,
        username: githubLogin,
        artifactId: input.artifactId,
      },
      {db},
    )
    console.log('[trpc-mw] access:', canAccess)
    if (!canAccess.canAccess) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `user ${githubLogin} is not authorized to access artifact ${input.artifactId}`,
      })
    }

    return next({ctx: {...ctx, artifact, octokit}})
  })

export const appRouter = router({
  logStackTrace: publicProcedure.query(async () => {
    const stack = new Error('test error for stack trace').stack
    logger.info(stack, {requestId: logger.getTag('requestId')})
    return {requestId: logger.getTag('requestId')}
  }),
  diagnoseArtifactRequest: publicProcedure.input(ArtifactDiagnosticInput).mutation(async ({input, ctx}) => {
    return diagnoseArtifactRequest({...input, githubLogin: ctx.githubLogin})
  }),
  getDownloadUrl: artifactAccessProcedure.query(async ({ctx}) => {
    const archiveResponse = await ctx.octokit.rest.actions.downloadArtifact({
      owner: ctx.artifact.owner,
      repo: ctx.artifact.repo,
      artifact_id: ctx.artifact.github_id,
      archive_format: 'zip',
      request: {redirect: 'manual'},
    })
    return {
      url: archiveResponse.headers.location!,
      githubId: ctx.artifact.github_id,
    }
  }),
  createUploadTokens: artifactAccessProcedure
    .input(z.object({entries: z.array(z.string())}))
    .mutation(async ({input, ctx: {artifact}}) => {
      const env = getAppEnv()
      const signer = new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
      })
      const createdAt = new Date(artifact.created_at)
      const artifactPathPrefix = [
        'github/artifacts',
        `${artifact.owner}/${artifact.repo}`,
        createdAt.toISOString().split(/\D/).slice(0, 3).join('/'),
        createdAt.toISOString().split('T')[1].replaceAll(':', '.'),
        artifact.name,
        artifact.id,
      ].join('/')
      logger.debug(`get tokens for entries on ${artifactPathPrefix}`, input)
      const tokens = await pMap(
        input.entries,
        async entry => {
          const contentType = mime.getType(entry) || 'text/plain'
          const artifactFullPath = artifactPathPrefix + '/' + entry
          const uploadUrl = await createR2PresignedPutUrl(env, signer, artifactFullPath)

          return {entry, artifactFullPath, uploadUrl, contentType}
        },
        {concurrency: 10},
      )

      return {tokens}
    }),
  storeUploadRecords: artifactAccessProcedure
    .input(
      z.object({
        uploads: z.array(z.object({entry: z.string(), artifactFullPath: z.string()})),
      }),
    )
    .mutation(async ({input, ctx}) => {
      const payload = input.uploads.map(u => ({
        entry_name: u.entry,
        aliases: getEntrypoints([u.entry]).flatAliases,
        storage_pathname: u.artifactFullPath,
      }))

      const d1 = getAppEnv().ARTIFACT_DB
      const results = payload.length
        ? await d1.batch(
            payload.map(entry =>
              d1
                .prepare(
                  `
                    insert into artifact_entries (
                      id,
                      artifact_id,
                      entry_name,
                      aliases,
                      storage_pathname
                    )
                    values (?, ?, ?, ?, ?)
                    on conflict (artifact_id, entry_name) do update set
                      aliases = excluded.aliases,
                      storage_pathname = excluded.storage_pathname,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    returning entry_name, aliases, storage_pathname
                  `,
                )
                .bind(
                  createPrefixedId('artifact_entry'),
                  input.artifactId,
                  entry.entry_name,
                  JSON.stringify(entry.aliases),
                  entry.storage_pathname,
                ),
            ),
          )
        : []
      const records = results
        .flatMap(result => result.results as Array<{entry_name: string; aliases: string; storage_pathname: string}>)
        .map(record => ({...record, aliases: parseJsonStringArray(record.aliases)}))

      return {
        artifact: ctx.artifact,
        records,
        entrypoints: getEntrypoints(records.map(u => u.entry_name)),
      }
    }),
  deleteEntries: artifactAccessProcedure.mutation(async ({input}) => {
    const db = getDb()
    const deletedEntries = await db.sql.all<{storage_pathname: string}>`
      delete from artifact_entries
      where artifact_id = ${input.artifactId}
      returning storage_pathname
    `
    const artifactRows = await db.sql.all<{
      id: string
      owner: string
      repo: string
    }>`
      select artifacts.id, r.owner, r.name as repo
      from artifacts
      join repos r on r.id = artifacts.repo_id
      where artifacts.id = ${input.artifactId}
    `
    const deleted = artifactRows[0] && {
      ...artifactRows[0],
      object_names: deletedEntries.map(entry => entry.storage_pathname),
      deleted_entries_count: deletedEntries.length,
    }

    await pMap(deleted?.object_names || [], async name => {
      logger.debug(`deleting artifact file: ${name}`)
      await getAppEnv().ARTIFACT_BLOBS.delete(name)
    })

    return deleted
  }),
})

function createR2PresignedPutUrl(env: AppEnv, signer: AwsClient, key: string) {
  const url = new URL(
    `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.ARTIFACT_BLOBS_BUCKET}/${encodeR2Key(key)}`,
  )
  url.searchParams.set('X-Amz-Expires', '600')
  return signer
    .sign(url, {
      method: 'PUT',
      aws: {signQuery: true},
    })
    .then(request => request.url)
}

const encodeR2Key = (key: string) => key.split('/').map(encodeURIComponent).join('/')

export type AppRouter = typeof appRouter
