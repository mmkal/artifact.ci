import {initTRPC, TRPCError} from '@trpc/server'
import mime from 'mime'
import {Session} from 'next-auth'
import pMap from 'p-suite/p-map'
import {z} from 'zod'
import {client, Id, sql} from '../db'
import {getEntrypoints} from '~/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/entrypoints'
import {checkCanAccess, getInstallationOctokit} from '~/auth'
import {supabaseStorageServiceRoleClient} from '~/storage/supabase'
import {logger} from '~/tag-logger'

export interface TrpcContext {
  session: Session | null
}

const t = initTRPC.context<TrpcContext>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const artifactAccessProcedure = t.procedure
  .input(
    z.object({
      artifactId: Id('artifact'),
    }),
  )
  .use(async ({input, ctx, next}) => {
    if (!ctx.session?.user.github_login) {
      throw new TRPCError({code: 'UNAUTHORIZED', message: 'not authenticated'})
    }
    const githubLogin = ctx.session.user.github_login
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
    if (!canAccess.result) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `user ${githubLogin} is not authorized to access artifact ${input.artifactId}`,
        cause: new Error(
          `user:${githubLogin}, no access reason:${canAccess.reason} repo:${artifact.owner}/${artifact.repo}`,
        ),
      })
    }

    return next({ctx: {...ctx, artifact, octokit}})
  })

export const appRouter = router({
  getDownloadUrl: artifactAccessProcedure.output(z.string()).query(async ({ctx}) => {
    const archiveResponse = await ctx.octokit.rest.actions.downloadArtifact({
      owner: ctx.artifact.owner,
      repo: ctx.artifact.repo,
      artifact_id: ctx.artifact.github_id,
      archive_format: 'zip',
      request: {redirect: 'manual'}, // without this it will follow the redirect and actually download the file, but we want to just give a signed url to the client
    })
    // https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28#download-an-artifact - "Look for `Location:` in the response header to find the URL for the download. The URL expires after 1 minute."
    return archiveResponse.headers.location!
  }),
  createUploadTokens: artifactAccessProcedure
    .input(z.object({entries: z.array(z.string())}))
    .mutation(async ({input, ctx: {artifact}}) => {
      const storage = supabaseStorageServiceRoleClient()
      const artifactPathPrefix = [
        'github/artifacts',
        `${artifact.owner}/${artifact.repo}`,
        artifact.created_at.toISOString().split(/\D/).slice(0, 3).join('/'), // date part in subfolders so when debugging can navigate to year/month/day
        artifact.created_at.toISOString().split('T')[1].replaceAll(':', '.'), // time part as a dot-separated string
        artifact.name,
        artifact.id,
      ].join('/')
      const tokens = await pMap(
        input.entries,
        async entry => {
          const contentType = mime.getType(entry) || 'text/plain'
          const artifactFullPath = artifactPathPrefix + '/' + entry
          const res = await storage.object.upload.sign
            .bucketName('artifact_files')
            .wildcard(artifactFullPath)
            .post({acceptStatus: ['200', '4XX']})

          let token: string | undefined
          if (res.statusMatch === '200') token = res.json.token
          else if (res.json.statusCode === '409') token = undefined
          else throw new Error(`upload failed: ${JSON.stringify(res.json)}`)

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
        sql<{
          entry_name: string
          aliases: string[]
          storage_object_id: string
        }>`
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
        logger.warn(`failed to delete artifact file: ${name}`, response, logger.memories())
      }
    })

    return deleted
  }),
})

export type AppRouter = typeof appRouter

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select a.*, gi.github_id as installation... [truncated] ...os r on r.id = a.repo_id where a.id = $1` */
  export interface Artifact {
    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.repo_id`, not null: `true`, regtype: `prefixed_ksuid` */
    repo_id: string

    /** column: `public.artifacts.name`, not null: `true`, regtype: `text` */
    name: string

    /** column: `public.artifacts.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.artifacts.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date

    /** column: `public.artifacts.download_url`, regtype: `text` */
    download_url: string | null

    /** column: `public.artifacts.github_id`, not null: `true`, regtype: `bigint` */
    github_id: number

    /** column: `public.artifacts.installation_id`, not null: `true`, regtype: `prefixed_ksuid` */
    installation_id: string

    /** column: `public.artifacts.visibility`, not null: `true`, regtype: `text` */
    visibility: string

    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    installation_github_id: number

    /** column: `public.repos.owner`, not null: `true`, regtype: `text` */
    owner: string

    /** column: `public.repos.name`, not null: `true`, regtype: `text` */
    repo: string
  }

  /** - query: `with deleted_entries as ( delete from ar... [truncated] ...rtifacts.repo_id where artifacts.id = $2` */
  export interface Deleted {
    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.repo_id`, not null: `true`, regtype: `prefixed_ksuid` */
    repo_id: string

    /** column: `public.artifacts.name`, not null: `true`, regtype: `text` */
    name: string

    /** column: `public.artifacts.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.artifacts.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date

    /** column: `public.artifacts.download_url`, regtype: `text` */
    download_url: string | null

    /** column: `public.artifacts.github_id`, not null: `true`, regtype: `bigint` */
    github_id: number

    /** column: `public.artifacts.installation_id`, not null: `true`, regtype: `prefixed_ksuid` */
    installation_id: string

    /** column: `public.artifacts.visibility`, not null: `true`, regtype: `text` */
    visibility: string

    /** column: `public.repos.owner`, not null: `true`, regtype: `text` */
    owner: string

    /** column: `public.repos.name`, not null: `true`, regtype: `text` */
    repo: string

    /**
     * From CTE subquery "subquery_3_for_column_object_names"
     *
     * column: `✨.subquery_3_for_column_object_names.object_names`, regtype: `text[]`
     */
    object_names: string[] | null

    /**
     * From CTE subquery "subquery_4_for_column_deleted_entries_count"
     *
     * column: `✨.subquery_4_for_column_deleted_entries_count.deleted_entries_count`, not null: `true`, regtype: `bigint`
     */
    deleted_entries_count: number
  }
}
