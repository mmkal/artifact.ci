import AdmZip from 'adm-zip'
import mime from 'mime'
import {NextRequest, NextResponse} from 'next/server'
import {App, Octokit} from 'octokit'
import {z} from 'zod'
import {fromError} from 'zod-validation-error'
import {AppWebhookEvent, WorkflowJobCompleted} from './types'
import {client, sql} from '~/db'
import {getLogger as getLoggerBase} from '~/logger'
import {createProxyClient} from '~/openapi/client'
import {paths} from '~/openapi/generated/supabase-storage'

const getLogger = (request: NextRequest) => {
  return getLoggerBase({debug: request.headers.get('artifactci-debug') === 'true'})
}

const getPreviewOrigin = (request: NextRequest, event: WorkflowJobCompleted) => {
  const {origin} = new URL(request.url)
  const normalizedOrigin = origin.replace('https://www', 'https://')
  const headBranch = event.workflow_job.head_branch
  const repo = event.repository.full_name

  if (normalizedOrigin !== 'https://artifactci.com') return null
  if (repo !== 'mmkal/artifact.ci') return null
  if (headBranch === 'main') return null

  const branchSlug = headBranch.replaceAll(/\W/g, '-')
  return `https://artifactci-git-${branchSlug}-mmkals-projects.vercel.app`
}

export async function POST(request: NextRequest) {
  const logger = getLogger(request)
  const body = (await request.json()) as {}
  logger.debug('event received', request.url, body)
  const parsed = AppWebhookEvent.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({error: fromError(parsed.error).message}, {status: 400})
  }
  const event = parsed.data

  const env = Env.parse(process.env)
  const app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  })

  if (event.eventType === 'workflow_job_completed') {
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

    // reruns can mean there are duplicates. Object.fromEntries effectively does last-write-wins
    // however if you have two artifacts with the same name, the first one will be dropped. so don't do that.
    const dedupedArtifacts = Object.values(Object.fromEntries(data.artifacts.map(a => [a.name, a])))

    // decision to be made - use sha or run_id as part of the url? sha is more accessible/meaningful, but run_id is more unique, though still not unique because of reruns.
    // maybe it can be either? like default template exists but user can override somehow?
    console.log('workflow run for go', dedupedArtifacts.find(a => a.name === 'go')!.workflow_run)

    const artifacts = await Promise.all(
      dedupedArtifacts.map(async a => {
        const {origin} = new URL(request.url)
        const viewUrl = `${origin}/artifact/view/${owner}/${repo}/${job.id}/${job.run_attempt}/${a.name}`
        const {entries} = await loadZip(octokit, a.archive_download_url)
        const dbArtifact = await client.one(sql<queries.Artifact>`
          insert into artifacts (repo_id, name, sha, workflow_run_id, workflow_run_attempt)
          values (${repo}, ${a.name}, ${event.workflow_job.head_sha}, ${job.run_id}, ${job.run_attempt})
          on conflict (repo_id, name, workflow_run_id, workflow_run_attempt) do update set updated_at = current_timestamp
          returning id, updated_at = current_timestamp as updated
        `)

        if (dbArtifact.updated) {
          const Env = z.object({
            SUPABASE_PROJECT_URL: z.string().url(),
            SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
          })
          const supabaseEnv = Env.parse(process.env)
          const storage = createProxyClient<paths>().configure({
            baseUrl: `${supabaseEnv.SUPABASE_PROJECT_URL}/storage/v1`,
            headers: {
              apikey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
              authorization: `Bearer ${supabaseEnv.SUPABASE_SERVICE_ROLE_KEY}`,
            },
          })

          for (const entry of entries) {
            const fullPathname = getFilepath({
              githubOwner: owner,
              githubRepo: repo,
              workflowRunId: job.id,
              workflowRunAttempt: job.run_attempt,
              artifactName: a.name,
              entryPath: entry.entryName,
            })
            const mimeType = mime.getType(entry.entryName) || 'text/plain'
            console.log('uploading entry', entry.entryName, 'to', fullPathname, 'as', mimeType)
            const file = await storage.object
              .bucketName('artifact_files')
              .wildcard(fullPathname)
              .put({
                content: {[mimeType]: entry.getData()},
              })

            console.log('uploaded', file.json)
          }
        }

        return {
          name: a.name,
          viewUrl,
          archiveDownloadUrl: a.archive_download_url,
          entries: entries.map(e => e.entryName),
        }
      }),
    )
    return NextResponse.json({ok: true, total: data.total_count, artifacts})
  }

  logger.warn('unknown event type', body)
  return NextResponse.json(
    {ok: false, error: 'unknown event type', eventType: event.eventType, action: event.action},
    {status: 400},
  )
}

const getFilepath = (params: {
  githubOwner: string
  githubRepo: string
  workflowRunId: number
  workflowRunAttempt: number
  artifactName: string
  entryPath: string
}) => {
  return `${params.githubOwner}/${params.githubRepo}/${params.workflowRunId}/${params.workflowRunAttempt}/${params.artifactName}/${params.entryPath}`
}

const loadZip = async (octokit: Octokit, url: string) => {
  const zipRes = await octokit.request(`GET ${url}`, {
    mediaType: {format: 'zip'},
  })
  const arrayBuffer = z.instanceof(ArrayBuffer).parse(zipRes.data)
  const zip = new AdmZip(Buffer.from(arrayBuffer))
  return {zip, entries: zip.getEntries()}
}

const Env = z.object({
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
})

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `insert into artifacts (repo_id, name, sh... [truncated] ...pdated_at = current_timestamp as updated` */
  export interface Artifact {
    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifacts'>

    /** regtype: `boolean` */
    updated: boolean | null
  }

  /** - query: `with deleted_files as ( delete from arti... [truncated] ... inserted_files join num_deleted on true` */
  export interface DbFile {
    /**
     * From CTE subquery "inserted_files", column source: public.artifact_files.id
     *
     * column: `✨.inserted_files.id`, not null: `true`, regtype: `prefixed_ksuid`
     */
    id: import('~/db').Id<'inserted_files'>

    /**
     * From CTE subquery "inserted_files", column source: public.artifact_files.artifact_id
     *
     * column: `✨.inserted_files.artifact_id`, not null: `true`, regtype: `prefixed_ksuid`
     */
    artifact_id: string

    /**
     * From CTE subquery "inserted_files", column source: public.artifact_files.filepath
     *
     * column: `✨.inserted_files.filepath`, not null: `true`, regtype: `text`
     */
    filepath: string

    /**
     * From CTE subquery "inserted_files", column source: public.artifact_files.bucket
     *
     * column: `✨.inserted_files.bucket`, not null: `true`, regtype: `text`
     */
    bucket: string

    /**
     * From CTE subquery "inserted_files", column source: public.artifact_files.provider
     *
     * column: `✨.inserted_files.provider`, not null: `true`, regtype: `text`
     */
    provider: string

    /**
     * From CTE subquery "num_deleted"
     *
     * column: `✨.num_deleted.count`, not null: `true`, regtype: `bigint`
     */
    num_deleted: number
  }
}
