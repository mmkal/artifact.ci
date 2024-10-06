import {initTRPC, TRPCError} from '@trpc/server'
import mime from 'mime'
import {} from 'next-auth/next'
import {Octokit} from 'octokit'
import pMap from 'p-map'
import {z} from 'zod'
import {client, Id, sql} from '../db'
import {storeArtifact} from '~/app/artifact/upload/actions'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
import {AugmentedSession, auth} from '~/auth'
import {createStorageClient} from '~/storage/supabase'

export interface TrpcContext {
  auth: AugmentedSession | null
}

const t = initTRPC.context<TrpcContext>().create()

export const router = t.router
export const publicProcedure = t.procedure

// todo: do a better authz check
// things to do first:
// - include the github login in the session so we don't need to make an extra request
// - shortcut if the user = repo owner
// - otherwise check if they have a repo_access_permission entry
// - otherwise use github api to check if user has access to repo
// - create a repo_access_permission entry if they have a usage credit
// - maybe separately, check that the user has a credit for this service (as opposed to allowed to see the repo artifacts)
// - might someday want to *allow* users to see repo artifacts even if they don't have a usage credit, for example if the repo is public or if the repo owner allows it
// export const authorizeRepoAccess = async (session: AugmentedSession | null, repo: {owner: string; repo: string}) => {
//   if (!session) return {authorized: false , error: 'not_authenticated'} as const
// }

export const artifactAccessProcedure = t.procedure
  .input(
    z.object({
      artifactId: Id('artifact'),
    }),
  )
  .use(async ({input, ctx, next}) => {
    const userOctokit = new Octokit({auth: ctx.auth?.jwt_access_token})
    const artifact = await client.one(sql<queries.Artifact>`
      select a.*, gi.github_id as installation_github_id, r.owner as repo_owner, r.name as repo_name
      from artifacts a
      join github_installations gi on gi.id = a.installation_id
      join repos r on r.id = a.repo_id
      where a.id = ${input.artifactId}
    `)
    try {
      await userOctokit.rest.actions.listWorkflowRunsForRepo({
        owner: artifact.repo_owner,
        repo: artifact.repo_name,
        per_page: 1,
      })
    } catch (error) {
      const {data: authedUser} = ctx.auth?.jwt_access_token
        ? await userOctokit.rest.users.getAuthenticated()
        : {data: null}
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `User ${authedUser?.login} is not authorized to access the requested artifact`,
        cause: error,
      })
    }
    return next({ctx: {...ctx, artifact}})
  })

export const appRouter = router({
  getDownloadUrl: artifactAccessProcedure.query(async ({input}) => {
    return client.oneFirst(
      sql<queries.GetDownloadUrl>`select download_url from artifacts where id = ${input.artifactId}`,
    )
  }),
  createUploadTokens: artifactAccessProcedure
    .input(
      z.object({
        entries: z.array(z.string()),
      }),
    )
    .mutation(async ({input, ctx: {artifact}}) => {
      const storage = createStorageClient()
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
  recordUploads: artifactAccessProcedure
    .input(
      z.object({
        uploads: z.array(
          z.object({entry: z.string(), artifactFullPath: z.string()}), //
        ),
      }),
    )
    .mutation(async ({input}) => {
      return client.any(
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

  /** - query: `select download_url from artifacts where id = $1` */
  export interface GetDownloadUrl {
    /** column: `public.artifacts.download_url`, not null: `true`, regtype: `text` */
    download_url: string
  }
}
