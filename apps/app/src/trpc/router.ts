import {initTRPC, TRPCError} from '@trpc/server'
import mime from 'mime'
import pMap from 'p-suite/p-map'
import {z} from 'zod'
import {client, Id, sql} from '@artifact/domain/db/client'
import {getEntrypoints} from '@artifact/domain/artifact/entrypoints'
import {checkCanAccess} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {supabaseStorageServiceRoleClient} from '@artifact/domain/storage/supabase'

export interface TrpcContext {
  githubLogin: string | null | undefined
  getHeader: (name: string) => string | null | undefined
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
    let githubLogin = ctx.githubLogin
    if (!githubLogin) {
      const uploadToken = ctx.getHeader('artifactci-upload-token')
      if (uploadToken) {
        githubLogin = await client.oneFirst(sql<queries.DecryptedSecret>`
          select decrypted_secret
          from vault.decrypted_secrets
          where secret = ${uploadToken}
          and created_at > now() - interval '10 minutes'
        `)
      }
    }
    if (!githubLogin) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'not authenticated'})
    }
    const artifact = await client.one(sql<queries.Artifact>`
      select a.*, gi.github_id as installation_github_id, r.owner, r.name as repo
      from artifacts a
      join github_installations gi on gi.id = a.installation_id
      join repos r on r.id = a.repo_id
      where a.id = ${input.artifactId}
    `)
    const octokit = await getInstallationOctokit(artifact.installation_github_id)

    const canAccess = await checkCanAccess(octokit, {
      ...artifact,
      username: githubLogin,
      artifactId: input.artifactId,
    })
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
      const artifactPathPrefix = [
        'github/artifacts',
        `${artifact.owner}/${artifact.repo}`,
        artifact.created_at.toISOString().split(/\D/).slice(0, 3).join('/'),
        artifact.created_at.toISOString().split('T')[1].replaceAll(':', '.'),
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
            responseHeaders: Object.fromEntries(res.response.headers),
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

          logger.info(`token: ${token}`)

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
      const records = await client.any(
        sql<{entry_name: string; aliases: string[]; storage_object_id: string}>`
          --typegen-ignore
          insert into artifact_entries (
            artifact_id,
            entry_name,
            aliases,
            storage_object_id
          )
          select
            ${input.artifactId} as artifact_id,
            entries.entry_name,
            entries.aliases,
            (
              select id
              from storage.objects
              where name = entries.storage_key
            ) as storage_object_id
          from jsonb_to_recordset(
            ${JSON.stringify(
              input.uploads.map(u => ({
                entry_name: u.entry,
                aliases: getEntrypoints([u.entry]).flatAliases,
                storage_key: u.artifactFullPath,
              })),
            )}
          ) as entries(
            entry_name text,
            aliases text[],
            storage_key text
          )
          on conflict (artifact_id, entry_name) do update set
            entry_name = excluded.entry_name
          returning entry_name, aliases, storage_object_id
        `,
      )

      return {
        artifact: ctx.artifact,
        records,
        entrypoints: getEntrypoints(records.map(u => u.entry_name)),
      }
    }),
  deleteEntries: artifactAccessProcedure.mutation(async ({input}) => {
    const deleted = await client.maybeOne(sql<queries.Deleted>`
      with deleted_entries as (
        delete from artifact_entries where artifact_id = ${input.artifactId}
        returning *
      ),
      storage_objects as (
        select name
        from storage.objects
        where id = any(select storage_object_id from deleted_entries)
      )
      select
        artifacts.*,
        r.owner,
        r.name as repo,
        (select array_agg(name) from storage_objects) object_names,
        (select count(*) from deleted_entries) deleted_entries_count
      from artifacts
      join repos r on r.id = artifacts.repo_id
      where artifacts.id = ${input.artifactId}
    `)

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

export declare namespace queries {
  export interface DecryptedSecret {
    decrypted_secret: string | null
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
    installation_github_id: number
    owner: string
    repo: string
  }

  export interface Deleted {
    id: Id<'artifacts'>
    repo_id: string
    name: string
    created_at: Date
    updated_at: Date
    download_url: string | null
    github_id: number
    installation_id: string
    visibility: string
    owner: string
    repo: string
    object_names: string[] | null
    deleted_entries_count: number
  }
}
