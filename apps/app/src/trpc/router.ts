import {initTRPC, TRPCError} from '@trpc/server'
import mime from 'mime'
import pMap from 'p-suite/p-map'
import {z} from 'zod'
import {Id} from '@artifact/domain/db/client'
import {getEntrypoints} from '@artifact/domain/artifact/entrypoints'
import {checkCanAccess} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {supabaseStorageServiceRoleClient} from '@artifact/domain/storage/supabase'
import {getPool} from '../auth/server-auth'

export interface TrpcContext {
  githubLogin: string | null | undefined
  getHeader: (name: string) => string | null | undefined
}

interface ArtifactRow {
  id: string
  repo_id: string
  name: string
  created_at: Date
  updated_at: Date
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
    console.log('[trpc-mw] start', {artifactId: input.artifactId})
    let pool: ReturnType<typeof getPool>
    try {
      pool = getPool()
      console.log('[trpc-mw] got pool')
    } catch (error) {
      console.log('[trpc-mw] getPool failed', error)
      throw error
    }
    let githubLogin = ctx.githubLogin
    if (!githubLogin) {
      const uploadToken = ctx.getHeader('artifactci-upload-token')
      console.log('[trpc-mw] have upload token?', Boolean(uploadToken))
      if (uploadToken) {
        try {
          const {rows} = await pool.query<{decrypted_secret: string | null}>(
            `select decrypted_secret
             from vault.decrypted_secrets
             where secret = $1
               and created_at > now() - interval '10 minutes'`,
            [uploadToken],
          )
          githubLogin = rows[0]?.decrypted_secret ?? undefined
          console.log('[trpc-mw] decrypted secret rows', rows.length)
        } catch (e) {
          console.log('[trpc-mw] decrypt query failed:', e instanceof Error ? e.message : e)
          throw e
        }
      }
    }
    if (!githubLogin) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'not authenticated'})
    }
    console.log('[trpc-mw] about to query artifact', input.artifactId)
    const {rows: artifactRows} = await pool.query<ArtifactRow>(
      `select a.*, gi.github_id as installation_github_id, r.owner, r.name as repo
       from artifacts a
       join github_installations gi on gi.id = a.installation_id
       join repos r on r.id = a.repo_id
       where a.id = $1`,
      [input.artifactId],
    )
    console.log('[trpc-mw] got artifact rows', artifactRows.length)
    if (!artifactRows[0]) {
      throw new TRPCError({code: 'NOT_FOUND', message: `artifact ${input.artifactId} not found`})
    }
    const artifact = {artifact: artifactRows[0], githubLogin}

    console.log('[trpc-mw] got artifact, install id:', artifact.artifact.installation_github_id)
    const octokit = await getInstallationOctokit(artifact.artifact.installation_github_id)
    console.log('[trpc-mw] got octokit')

    const canAccess = await checkCanAccess(octokit, {
      owner: artifact.artifact.owner,
      repo: artifact.artifact.repo,
      username: artifact.githubLogin,
      artifactId: input.artifactId,
    })
    console.log('[trpc-mw] access:', canAccess)
    if (!canAccess.canAccess) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `user ${artifact.githubLogin} is not authorized to access artifact ${input.artifactId}`,
      })
    }

    return next({ctx: {...ctx, artifact: artifact.artifact, octokit}})
  })

export const appRouter = router({
  logStackTrace: publicProcedure.query(async () => {
    const stack = new Error('test error for stack trace').stack
    logger.info(stack, {requestId: logger.getTag('requestId')})
    return {requestId: logger.getTag('requestId')}
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
      const storage = supabaseStorageServiceRoleClient()
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
          const res = await storage.object.upload.sign
            .bucketName('artifact_files')
            .wildcard(artifactFullPath)
            .post({acceptStatus: ['200', '4XX']})

          logger.debug(`status ${res.response.status} for ${artifactFullPath}`, {
            expectingContentType: contentType,
            responseUrl: res.response.url,
          })

          let token: string | undefined
          if (res.statusMatch === '200') {
            const json: typeof res.json = (await res.response.clone().json()) as never
            token = json.token
          } else {
            const json: typeof res.json = (await res.response.clone().json()) as never
            if (json.statusCode === '409') token = undefined
            else new Error(`upload failed: ${JSON.stringify(json)}`)
          }

          return {entry, artifactFullPath, token, contentType}
        },
        {concurrency: 10},
      )

      return {tokens, supabaseUrl: storage.$options.baseUrl}
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
        storage_key: u.artifactFullPath,
      }))

      const pool = getPool()
      const {rows: records} = await pool.query<{entry_name: string; aliases: string[]; storage_object_id: string}>(
        `insert into artifact_entries (
           artifact_id,
           entry_name,
           aliases,
           storage_object_id
         )
         select
           $1 as artifact_id,
           entries.entry_name,
           entries.aliases,
           (
             select id
             from storage.objects
             where name = entries.storage_key
           ) as storage_object_id
         from jsonb_to_recordset($2::jsonb) as entries(
           entry_name text,
           aliases text[],
           storage_key text
         )
         on conflict (artifact_id, entry_name) do update set
           entry_name = excluded.entry_name
         returning entry_name, aliases, storage_object_id`,
        [input.artifactId, JSON.stringify(payload)],
      )

      return {
        artifact: ctx.artifact,
        records,
        entrypoints: getEntrypoints(records.map(u => u.entry_name)),
      }
    }),
  deleteEntries: artifactAccessProcedure.mutation(async ({input}) => {
    const pool = getPool()
    const {rows} = await pool.query<{
      id: string
      owner: string
      repo: string
      object_names: string[] | null
      deleted_entries_count: number
    }>(
      `with deleted_entries as (
         delete from artifact_entries where artifact_id = $1
         returning *
       ),
       storage_objects as (
         select name
         from storage.objects
         where id = any(select storage_object_id from deleted_entries)
       )
       select
         artifacts.id,
         r.owner,
         r.name as repo,
         (select array_agg(name) from storage_objects) as object_names,
         (select count(*)::int from deleted_entries) as deleted_entries_count
       from artifacts
       join repos r on r.id = artifacts.repo_id
       where artifacts.id = $1`,
      [input.artifactId],
    )
    const deleted = rows[0]

    const storage = supabaseStorageServiceRoleClient()
    await pMap(deleted?.object_names || [], async name => {
      logger.debug(`deleting artifact file: ${name}`)
      const response = await storage.object
        .bucketName('artifact_files')
        .wildcard(name)
        .delete({acceptStatus: ['200', '4XX']})

      if (response.statusMatch === '4XX') {
        logger.warn(`failed to delete artifact file: ${name}`, response)
      }
    })

    return deleted
  }),
})

export type AppRouter = typeof appRouter
