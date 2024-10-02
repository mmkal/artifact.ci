import AdmZip from 'adm-zip'
import mime from 'mime'
import {NextRequest, NextResponse} from 'next/server'
import {App, Octokit} from 'octokit'
import {z} from 'zod'
import {fromError} from 'zod-validation-error'
import {AppWebhookEvent, WorkflowJobCompleted} from './types'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
import {client, sql} from '~/db'
import {getLogger as getLoggerBase} from '~/logger'
import {insertFiles} from '~/storage/supabase'

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

  if (event.eventType === 'ignored_action') {
    return NextResponse.json({
      ok: true,
      eventType: event.eventType,
      action: event.action,
    })
  }

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
    console.log('workflow run found', dedupedArtifacts.find(a => a.name === 'html')?.workflow_run)

    const artifacts = await Promise.all(
      dedupedArtifacts.map(async a => {
        const {origin} = new URL(request.url)
        const viewUrl = `${origin}/artifact/view/${owner}/${repo}/${job.id}/${job.run_attempt}/${a.name}`
        const {entries} = await loadZip(octokit, a.archive_download_url)
        const dbArtifact = await client.one(sql<queries.Artifact>`
          with repo as (
            select id as repo_id from repos where name = ${repo} and owner = ${owner}
          )
          insert into artifacts (repo_id, name, sha, workflow_run_id, workflow_run_attempt)
          select repo.repo_id, ${a.name} as name, ${event.workflow_job.head_sha} as sha, ${job.run_id} as workflow_run_id, ${job.run_attempt} as workflow_run_attempt
          from repo
          on conflict (repo_id, name, workflow_run_id, workflow_run_attempt) do update set updated_at = current_timestamp
          returning
            id,
            updated_at = current_timestamp as updated
        `)

        const meta = {
          name: a.name,
          viewUrl,
          archiveDownloadUrl: a.archive_download_url,
          entries: entries.map(e => e.entryName),
        }

        if (dbArtifact.updated) {
          const fileInfo = entries.map(entry => {
            const jobPathname = `${owner}/${repo}/job/${job.id}/${job.run_attempt}/${a.name}/${entry.entryName}`
            const shaPathname = `${owner}/${repo}/sha/${event.workflow_job.head_sha}/${a.name}/${entry.entryName}`
            const branchPathname = `${owner}/${repo}/branch/${event.workflow_job.head_branch}/${a.name}/${entry.entryName}`
            // todo: tags?
            const {flatAliases: aliases} = getEntrypoints([jobPathname, shaPathname, branchPathname])
            const mimeType = mime.getType(entry.entryName) || 'text/plain'

            return {mimeType, aliases, jobPathname, entry}
          })
          const {inserts, files} = await insertFiles(dbArtifact, fileInfo)

          console.log('inserted', inserts.length)

          await octokit.rest.checks.create({
            owner,
            repo,
            name: `artifact.ci: ${a.name}`,
            head_sha: event.workflow_job.head_sha,
            status: 'completed',
            output: {
              title: 'artifact.ci',
              summary: 'your artifacts are ready',
              text: files
                .map(f => f.aliases[0]) //
                .join('\n'),
            },
          })
        }

        return meta
      }),
    )
    return NextResponse.json({ok: true, total: data.total_count, artifacts})
  }

  logger.warn('unknown event type', body)
  return NextResponse.json({ok: false, error: 'unexpected body', keys: Object.keys(event)}, {status: 400})
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

  /** - query: `with repo as ( select id as repo_id from... [truncated] ...pdated_at = current_timestamp as updated` */
  export interface Artifact {
    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'artifacts'>

    /** regtype: `boolean` */
    updated: boolean | null
  }
}
