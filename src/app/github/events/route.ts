import {NextRequest, NextResponse} from 'next/server'
import {fromError} from 'zod-validation-error'
import {AppWebhookEvent, WorkflowJobCompleted} from './types'
import {getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {ARTIFACT_BLOB_PREFIX} from '~/routing'
import {logger} from '~/tag-logger'

/** either the preview origin (for this repo) or null if another repo/for the default branch */
const getPreviewOrigin = (request: NextRequest, event: WorkflowJobCompleted) => {
  const {hostname} = new URL(request.url)
  const headBranch = event.workflow_job.head_branch
  const repo = event.repository.full_name

  if (hostname !== 'artifact.ci') return null
  if (repo !== 'mmkal/artifact.ci') return null
  if (headBranch === 'main') return null

  return getPreviewUrl(headBranch)
}

/** either the preview origin (for this repo) or the same origin as from the request */
const getOrigin = (request: NextRequest, event: WorkflowJobCompleted) => {
  return getPreviewOrigin(request, event) || new URL(request.url).origin
}

const getPreviewUrl = (branch: string) => {
  const branchSlug = branch.replaceAll(/\W/g, '-')
  return `https://artifactci-git-${branchSlug}-mmkals-projects.vercel.app`
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {}
  logger.debug('event received', request.url, body)
  const parsed = AppWebhookEvent.safeParse(body)
  if (!parsed.success) {
    logger.error('error parsing event', parsed.error)
    return NextResponse.json({error: fromError(parsed.error).message}, {status: 500})
  }

  const event = parsed.data
  return logger.run([`event=${event.eventType}`, `action=${event.action}`], async () => {
    const result = await handleEvent(request, parsed.data)
    if (parsed.data.eventType === 'workflow_job_update' && parsed.data.repository.full_name !== 'mmkal/artifact.ci') {
      logger.info('memories', logger.memories())
    }
    return result
  })
}

async function handleEvent(request: NextRequest, event: AppWebhookEvent) {
  if (event.eventType === 'ignored_action') {
    return NextResponse.json({ok: true, action: event.action, eventType: event.eventType})
  }

  if (event.eventType !== 'workflow_job_update') {
    logger.warn('unknown event type')
    return NextResponse.json({ok: false, error: 'unexpected body', keys: Object.keys(event)}, {status: 400})
  }

  const doit = async () => {
    const previewOrigin = getPreviewOrigin(request, event)
    if (previewOrigin) {
      const url = new URL(request.url)
      const previewUrl = url.toString().replace(url.origin, previewOrigin)
      return NextResponse.rewrite(previewUrl)
    }

    const job = event.workflow_job
    const [owner, repo] = event.repository.full_name.split('/')
    const octokit = await getInstallationOctokit(event.installation.id)
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

    const artifacts = await Promise.all(
      dedupedArtifacts.map(async a => {
        return logger.run(`artifact=${a.name}`, async () => {
          await client.query(sql`
            insert into repos (owner, name)
            values (${owner}, ${repo})
            on conflict (owner, name) do nothing;

            insert into github_installations (github_id)
            select ${event.installation.id}
            on conflict (github_id) do nothing;
          `)
          const txResult = await client.transaction(async tx => {
            const installation = await tx.one(sql<queries.GithubInstallation>`
              select * from github_installations where github_id = ${event.installation.id}
            `)
            const dbRepo = await tx.one(
              sql<queries.Repo>`
                select id from repos where name = ${repo} and owner = ${owner}
              `,
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
                ${JSON.stringify([
                  {artifact_id: dbArtifact.id, type: 'run', value: `${job.run_id}.${job.run_attempt}`},
                  {artifact_id: dbArtifact.id, type: 'sha', value: event.workflow_job.head_sha},
                  {artifact_id: dbArtifact.id, type: 'branch', value: event.workflow_job.head_branch},
                ])}
              )
              on conflict (artifact_id, type, value)
              do update set updated_at = current_timestamp
              returning *
            `)
            return {dbArtifact, dbIdentifiers}
          })

          return {
            name: a.name,
            artifactId: txResult.dbArtifact.id,
            identifiers: txResult.dbIdentifiers,
          }
        })
      }),
    )

    const entrypointSummaries = artifacts.map(arti => {
      const identifierLinks = arti.identifiers.map(({type, value}) => {
        const origin = getOrigin(request, event)
        const url = origin + ARTIFACT_BLOB_PREFIX + `${owner}/${repo}/${type}/${value}/${arti.name}`
        return `[${type}](${url})`
      })
      return `- **${arti.name}**: ${identifierLinks.join(' / ')}`
    })

    if (entrypointSummaries.length > 0) {
      const jobsCompleted = jobsForRun.jobs.filter(j => j.status === 'completed').length
      const jobInfo =
        jobsForRun.total_count === 1 ? '' : ` (${jobsCompleted} of ${jobsForRun.total_count} jobs completed)`
      const output = {
        title: `Workflow ${job.workflow_name}: ${artifacts.length} artifacts${jobInfo}`,
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
  return logger.run(`job=${event.workflow_job.name}`, doit)
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

  /** - query: `with insertion as ( insert into repos (n... [truncated] ...rom repos where name = $3 and owner = $4` */
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
