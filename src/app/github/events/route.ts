import {NextRequest, NextResponse} from 'next/server'
import {fromError} from 'zod-validation-error'
import {getOrigin, getPreviewOrigin, insertArtifactRecord} from '../upload/route'
import {AppWebhookEvent} from './types'
import {toPath} from '~/app/artifact/view/params'
import {getInstallationOctokit, validateGithubWebhook} from '~/auth'
import {client, sql} from '~/db'
import {productionUrl} from '~/site-config'
import {logger} from '~/tag-logger'

export async function POST(request: NextRequest) {
  const json = await request.text()
  logger.debug('event received', {url: request.url, text: json.slice(0, 200), headers: request.headers})

  const isValid = await validateGithubWebhook(request, json)
  if (!isValid) {
    logger.warn('invalid signature was sent')
    return NextResponse.json({error: 'invalid signature'}, {status: 400})
  }

  const parsed = AppWebhookEvent.safeParse(JSON.parse(json))
  if (!parsed.success) {
    logger.error('error parsing event', fromError(parsed.error), {json})
    // better to call this a 500 than a 400, much more likely my zod schemas are bad than github is sending bad data
    return NextResponse.json({error: fromError(parsed.error).message}, {status: 500})
  }

  const event = parsed.data
  return logger.run([`event=${event.eventType}`, `action=${event.action}`], async () => {
    return handleEvent(request, parsed.data)
  })
}

async function handleEvent(request: NextRequest, event: AppWebhookEvent) {
  if (
    event.eventType === 'workflow_job_not_completed' ||
    event.eventType === 'installation_added' ||
    event.eventType === 'installation_removed' ||
    event.eventType === 'unknown_action'
  ) {
    return NextResponse.json({ok: true, action: event.action, eventType: event.eventType})
  }

  if (event.eventType !== 'workflow_job_completed') {
    event satisfies never // make sure at compile time we checked for all "ok" cases above
    logger.warn('unknown event type')
    return NextResponse.json({ok: false, error: 'unexpected body', keys: Object.keys(event)}, {status: 500})
  }

  return logger.run(`job=${event.workflow_job.name}`, async () => {
    const previewOrigin = getPreviewOrigin(request, {
      repo: event.repository.full_name,
      branch: event.workflow_job.head_branch,
    })
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
          await client.query(sql<queries._void>`
            insert into github_installations (github_id)
            select ${event.installation.id}
            on conflict (github_id) do nothing
          `)
          await client.query(sql<queries._void>`
            insert into repos (owner, name, installation_id)
            values (
              ${owner},
              ${repo},
              (select id from github_installations where github_id = ${event.installation.id})
            )
            on conflict (owner, name) do nothing;
          `)

          const txResult = await insertArtifactRecord({owner, repo, job, artifact: a, installation: event.installation})

          const origin = getOrigin(request, {repo: event.repository.full_name, branch: job.head_branch})
          return {
            name: a.name,
            artifactId: txResult.dbArtifact.id,
            links: txResult.dbIdentifiers.map(({type: aliasType, value: identifier}) => {
              return {
                aliasType,
                url: origin + toPath({owner, repo, aliasType, identifier, artifactName: a.name}),
              }
            }),
          }
        })
      }),
    )

    const jobsCompleted = jobsForRun.jobs.filter(j => j.status === 'completed').length
    if (artifacts.length === 1 && jobsForRun.total_count === jobsCompleted) {
      await octokit.rest.checks.create({
        owner,
        repo,
        name: productionUrl.hostname,
        details_url: artifacts[0].links[0].url,
        head_sha: event.workflow_job.head_sha,
        conclusion: 'success',
      })
    } else if (artifacts.length > 0) {
      const summaries = artifacts.map(arti => {
        return `- **${arti.name}**: ${arti.links.map(i => `[${i.aliasType}](${i.url})`).join(' / ')}`
      })
      const output = {
        title: `${artifacts.length} artifacts (${jobsCompleted} of ${jobsForRun.total_count} jobs completed)`,
        summary: 'The following artifacts are ready to view',
        text: summaries.join('\n'),
      }
      await octokit.rest.checks.create({
        owner,
        repo,
        name: productionUrl.hostname,
        head_sha: event.workflow_job.head_sha,
        conclusion: 'success',
        output,
      })
    }
    return NextResponse.json({ok: true, total: data.total_count, artifacts})
  })
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /**
   * queries:
   * - `insert into github_installations (github_id) select $1 on conflict (github_id) do nothing`
   * - `insert into repos (owner, name, installa... [truncated] ... ) on conflict (owner, name) do nothing;`
   */
  export type _void = {}
}
