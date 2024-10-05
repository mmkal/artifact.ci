import {initTRPC} from '@trpc/server'
import mime from 'mime'
import pMap from 'p-map'
import {z} from 'zod'
import {client, Id, sql} from '../db'
import {storeArtifact} from '~/app/artifact/upload/actions'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
import {createStorageClient} from '~/storage/supabase'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  getDownloadUrl: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'), //
      }),
    )
    .query(async ({input}) => {
      return client.oneFirst(sql<queries.Artifact>`select download_url from artifacts where id = ${input.artifactId}`)
    }),
  createUploadTokens: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'),
        entries: z.array(z.string()),
      }),
    )
    .mutation(async ({input}) => {
      const storage = createStorageClient()
      const artifact = await client.one(sql<queries.Artifact_CreateUploadToken>`
        select a.*, gi.github_id as installation_github_id, r.owner as repo_owner, r.name as repo_name
        from artifacts a
        join github_installations gi on gi.id = a.installation_id
        join repos r on r.id = a.repo_id
        where a.id = ${input.artifactId}
      `)
      const artifactPathPrefix = [
        'github/artifacts',
        `${artifact.repo_owner}/${artifact.repo_name}`,
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
          const {json} = await storage.object.upload.sign
            .bucketName('artifact_files')
            .wildcard(artifactFullPath)
            .post({})
          return {
            entry,
            url: json.url,
            artifactFullPath,
            token: json.token!.slice(),
            contentType,
          }
        },
        {concurrency: 10},
      )

      return {tokens, supabaseUrl: storage.$options.baseUrl}
    }),
  recordUploads: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'), //
        uploads: z.array(
          z.object({
            entry: z.string(),
            uploadKey: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      // with entries as (
      //   select artifact_id, entry_name, aliases, storage_object_id
      //   from jsonb_populate_recordset(
      //     null::artifact_entries,
      //     ${JSON.stringify(
      //       input.uploads.map(u => ({
      //         entry_name: u.entry,
      //         aliases: getEntrypoints([u.entry]).flatAliases,
      //         storage_object_id: u.key,
      //       })),
      //     )}
      //   )
      // ),
      // ids as (
      //   select
      //     (select id from storage.objects where name = entries)
      //   from entries
      // )
      return client
        .any(
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
                  storage_key: u.uploadKey,
                })),
              )}
            ) as entries(
              entry_name text,
              aliases text[],
              storage_key text
            )
            returning entry_name, aliases, storage_object_id
          `,
        )
        .catch(e => {
          console.error({e})
          throw e
        })
    }),
  startArtifactProcessing: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'), //
      }),
    )
    .mutation(async function* ({input}) {
      console.log('startArtifactProcessing', input)
      for await (const event of storeArtifact(input)) {
        console.log('event', event)
        yield event
      }
    }),
})

export type AppRouter = typeof appRouter

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select download_url from artifacts where id = $1` */
  export interface Artifact {
    /** column: `public.artifacts.download_url`, not null: `true`, regtype: `text` */
    download_url: string
  }

  /** - query: `select a.*, gi.github_id as installation... [truncated] ...os r on r.id = a.repo_id where a.id = $1` */
  export interface Artifact_CreateUploadToken {
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

    /** column: `public.artifacts.download_url`, not null: `true`, regtype: `text` */
    download_url: string

    /** column: `public.artifacts.github_id`, not null: `true`, regtype: `bigint` */
    github_id: number

    /** column: `public.artifacts.installation_id`, not null: `true`, regtype: `prefixed_ksuid` */
    installation_id: string

    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    installation_github_id: number

    /** column: `public.repos.owner`, not null: `true`, regtype: `text` */
    repo_owner: string

    /** column: `public.repos.name`, not null: `true`, regtype: `text` */
    repo_name: string
  }
}
