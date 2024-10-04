import AdmZip from 'adm-zip'
import mime from 'mime'
import {NextRequest, NextResponse} from 'next/server'
import {App, Octokit} from 'octokit'
import {z} from 'zod'
import {fromError} from 'zod-validation-error'
import {AppWebhookEvent, WorkflowJobCompleted} from './types'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
import {ARTIFACT_BLOB_PREFIX} from '~/app/artifact/view/[...slug]/route'
import {client, sql} from '~/db'
import {insertFiles} from '~/storage/supabase'
import {logger} from '~/tag-logger'

const getPreviewOrigin = (request: NextRequest, event: WorkflowJobCompleted) => {
  const {origin} = new URL(request.url)
  const normalizedOrigin = origin.replace('https://www', 'https://')
  const headBranch = event.workflow_job.head_branch
  const repo = event.repository.full_name

  if (normalizedOrigin !== 'https://artifact.ci') return null
  if (repo !== 'mmkal/artifact.ci') return null
  if (headBranch === 'main') return null

  const branchSlug = headBranch.replaceAll(/\W/g, '-')
  return `https://artifactci-git-${branchSlug}-mmkals-projects.vercel.app`
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {}
  logger.debug('event received', request.url, body)
  const parsed = AppWebhookEvent.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({error: fromError(parsed.error).message}, {status: 400})
  }
  return logger.run(`event=${parsed.data.eventType}`, async () => {
    const event = parsed.data

    const env = Env.parse(process.env)
    const app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
    })

    if (event.eventType === 'ignored_action') {
      return NextResponse.json({
        ok: true,
        action: event.action,
        eventType: event.eventType,
      })
    }

    if (event.eventType === 'workflow_job_update') {
      const doit = async () => {
        const previewOrigin = getPreviewOrigin(request, event)
        if (previewOrigin) {
          const url = new URL(request.url)
          const previewUrl = url.toString().replace(url.origin, previewOrigin)
          return NextResponse.rewrite(previewUrl)
        }

        const job = event.workflow_job
        const [owner, repo] = event.repository.full_name.split('/')
        const octokit = await app.getInstallationOctokit(event.installation.id)
        const {data} = await octokit.rest.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: job.run_id,
        })
        const {data: jobsForRun} = await octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: job.run_id,
        })

        // reruns can mean there are duplicates. Object.fromEntries effectively does last-write-wins
        // however if you have two artifacts with the same name, the first one will be dropped. so don't do that.
        const dedupedArtifacts = Object.values(Object.fromEntries(data.artifacts.map(a => [a.name, a])))

        // decision to be made - use sha or run_id as part of the url? sha is more accessible/meaningful, but run_id is more unique, though still not unique because of reruns.
        // maybe it can be either? like default template exists but user can override somehow?
        console.log('workflow run found', dedupedArtifacts.find(a => a.name === 'html')?.workflow_run)

        const artifacts = await Promise.all(
          dedupedArtifacts.map(async a => {
            return logger.run(`artifact=${a.name}`, async () => {
              const txResult = await client.transaction(async tx => {
                const installation = await tx.one(sql<queries.GithubInstallation>`
                  with insertion as (
                    insert into github_installations (github_id)
                    select ${event.installation.id}
                    on conflict (github_id) do nothing
                  )
                  select * from github_installations where github_id = ${event.installation.id}
                `)
                const dbRepo = await tx.one(
                  sql<queries.Repo>`select id from repos where name = ${repo} and owner = ${owner}`,
                )
                const dbArtifact = await tx.one(sql<queries.Artifact>`
                  insert into artifacts (repo_id, name, github_id, download_url, installation_id)
                  select
                    ${dbRepo.id} as repo_id,
                    ${a.name} as name,
                    ${a.id} as github_id,
                    ${a.archive_download_url} as download_url,
                    ${installation.id} as installation_id
                  on conflict (repo_id, name, github_id)
                    do update set
                      updated_at = current_timestamp
                  returning *
                `)

                const dbIdentifiers = await tx.many(sql<queries.ArtifactIdentifier>`
                  insert into artifact_identifiers (artifact_id, type, value)
                  select artifact_id, type, value
                  from jsonb_populate_recordset(
                    null::artifact_identifiers,
                    ${JSON.stringify(
                      [
                        {type: 'run', value: `${job.run_id}.${job.run_attempt}`},
                        {type: 'sha', value: event.workflow_job.head_sha},
                        {type: 'branch', value: event.workflow_job.head_branch},
                      ].map(i => {
                        return {artifact_id: dbArtifact.id, ...i}
                      }),
                    )}
                  )
                  on conflict (artifact_id, type, value)
                  do update set updated_at = current_timestamp
                  returning *
                `)
                return {dbArtifact, dbIdentifiers}
              })
              // const dbArtifactIdentifiers = await client.many(sql<queries.DbArtifactIdentifier>`
              //   with create_installation as (
              //     insert into github_installations (github_id)
              //     select ${event.installation.id}
              //     on conflict (github_id) do nothing
              //   ),
              //   get_installation as (
              //     select id as installation_id from github_installations where github_id = ${a.id}
              //   ),
              //   repo as (
              //     select id as repo_id from repos where name = ${repo} and owner = ${owner}
              //   ),
              //   artifact_insert as (
              //     insert into artifacts (
              //       repo_id,
              //       name,
              //       github_id,
              //       download_url,
              //       installation_id
              //     )
              //     select
              //       repo.repo_id,
              //       ${a.name} as name,
              //       ${a.id} as github_id,
              //       ${a.archive_download_url} as download_url,
              //       get_installation.installation_id
              //     from repo
              //     join get_installation on true
              //     on conflict (repo_id, name, github_id)
              //       do update set
              //         updated_at = current_timestamp
              //     returning
              //       id,
              //       name,
              //       repo_id,
              //       installation_id,
              //       created_at,
              //       updated_at > created_at as updated
              //   ),
              //   identifiers as (
              //     select type, value from jsonb_populate_recordset(
              //       null::artifact_identifiers,
              //       ${JSON.stringify([
              //         {type: 'run', value: `${job.run_id}.${job.run_attempt}`},
              //         {type: 'sha', value: event.workflow_job.head_sha},
              //         {type: 'branch', value: event.workflow_job.head_branch},
              //       ])}
              //     )
              //   ),
              //   identifier_insert as (
              //     insert into artifact_identifiers (artifact_id, type, value)
              //     select
              //       artifact_insert.id as artifact_id,
              //       identifiers.type,
              //       identifiers.value
              //     from artifact_insert
              //     join identifiers on true
              //     returning *
              //   )
              //   select identifier_insert.*, artifact_insert.repo_id
              //   from identifier_insert
              //   join artifact_insert on true
              // `)

              return {
                name: a.name,
                artifactId: txResult.dbArtifact.id,
                identifiers: txResult.dbIdentifiers,
              }

              // const meta = {
              //   name: a.name,
              //   archiveDownloadUrl: a.archive_download_url,
              //   repoId: dbArtifact.repo_id,
              //   artifactId: dbArtifact.artifact_id,
              //   files: null,
              //   inserts: null,
              //   entries: null,
              // }

              // if (Math.random()) {
              //   // we no longer want to extract and store the files here - many of them will probably never be looked at and it's too slow, esp for matrix jobs
              //   return meta
              // }

              // if (dbArtifact.updated) {
              //   const {entries} = await loadZip(octokit, a.archive_download_url)
              //   const fileInfo = entries.map(entry => {
              //     const runPathname = `${owner}/${repo}/run/${job.run_id}.${job.run_attempt}/${a.name}/${entry.entryName}`
              //     const shaPathname = `${owner}/${repo}/sha/${event.workflow_job.head_sha}/${a.name}/${entry.entryName}`
              //     const branchPathname = `${owner}/${repo}/branch/${event.workflow_job.head_branch}/${a.name}/${entry.entryName}`
              //     // todo: tags?
              //     const {flatAliases: aliases} = getEntrypoints([runPathname, shaPathname, branchPathname])
              //     if (a.name === 'website' && runPathname.endsWith('.html')) {
              //       console.log(a.name, runPathname, {aliases})
              //     }
              //     const mimeType = mime.getType(entry.entryName) || 'text/plain'

              //     return {mimeType, aliases, runPathname, entry}
              //   })
              //   const {inserts, files} = await insertFiles({...dbArtifact, repo: {owner, repo}}, fileInfo).catch(e => {
              //     logger.error(`error inserting files ${e} ${fileInfo[0].entry.entryName}`)
              //     return {files: undefined, inserts: undefined}
              //   })

              //   logger.info(`inserted ${inserts?.length} records for ${files?.length} files`)

              //   return {...meta, files, inserts, entries}
              // }

              // return meta
            })
          }),
        )

        const entrypointSummaries = artifacts.map(arti => {
          const identifierLinks = arti.identifiers.map(({type, value}) => {
            const url =
              new URL(request.url).origin + ARTIFACT_BLOB_PREFIX + `${owner}/${repo}/${type}/${value}/${arti.name}`
            return `[${type}](${url})`
          })
          return `- **${arti.name}**: ${identifierLinks.join(' / ')}`
        })

        if (entrypointSummaries.length > 0) {
          const jobsCompleted = jobsForRun.jobs.filter(j => j.status === 'completed').length
          const jobInfo =
            jobsForRun.total_count === 1 ? '' : ` (${jobsCompleted} of ${jobsForRun.total_count} jobs completed)`
          const output = {
            title: `${artifacts.length} artifacts${jobInfo}`,
            summary: 'The following artifacts are ready to view' + jobInfo,
            text: 'Entrypoints:\n\n' + entrypointSummaries.join('\n'),
          }
          await octokit.rest.checks.create({
            owner,
            repo,
            name: `artifact.ci`,
            head_sha: event.workflow_job.head_sha,
            status: 'completed',
            conclusion: 'success',
            output,
          })
        }
        return NextResponse.json({ok: true, total: data.total_count, artifacts})
      }
      return logger.run(`action=${event.action}`, async () => {
        return logger.run(`job=${event.workflow_job.name}`, () => {
          return doit()
        })
      })
    }

    logger.warn('unknown event type', body)
    return NextResponse.json({ok: false, error: 'unexpected body', keys: Object.keys(event)}, {status: 400})
  })
}

export const Env = z.object({
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
})

export const getOctokitApp = () => {
  const env = Env.parse(process.env)
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  })
}

export const getInstallationOctokit = async (installationId: number) => {
  const app = getOctokitApp()
  return app.getInstallationOctokit(installationId)
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `with insertion as ( insert into github_i... [truncated] ...ithub_installations where github_id = $2` */
  export interface GithubInstallation {
    /** column: `public.github_installations.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'github_installations'>

    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    github_id: number

    /** column: `public.github_installations.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.github_installations.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date
  }

  /** - query: `select id from repos where name = $1 and owner = $2` */
  export interface Repo {
    /** column: `public.repos.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'repos'>
  }

  /** - query: `insert into artifacts (repo_id, name, gi... [truncated] ...dated_at = current_timestamp returning *` */
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
  }

  /** - query: `insert into artifact_identifiers (artifa... [truncated] ...dated_at = current_timestamp returning *` */
  export interface ArtifactIdentifier {
    /** column: `public.artifact_identifiers.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifact_identifiers'>

    /** column: `public.artifact_identifiers.artifact_id`, not null: `true`, regtype: `prefixed_ksuid` */
    artifact_id: string

    /** column: `public.artifact_identifiers.type`, not null: `true`, regtype: `text` */
    type: string

    /** column: `public.artifact_identifiers.value`, not null: `true`, regtype: `text` */
    value: string

    /** column: `public.artifact_identifiers.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.artifact_identifiers.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date
  }
}
