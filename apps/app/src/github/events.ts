import {captureServerEvent} from '@artifact/domain/analytics/posthog-server'
import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {AppWebhookEvent} from '@artifact/domain/github/events-types'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {validateGithubWebhook} from '@artifact/domain/github/webhook-validator'
import {logger} from '@artifact/domain/logging/tag-logger'
import {fromError} from 'zod-validation-error'
import {getDb} from '../cloudflare-env'
import {getArtifactOrigin} from './origin'
import {insertArtifactRecord, storeInstallationAndRepo} from './upload'

export async function handleWebhookRequest(request: Request): Promise<Response> {
  try {
    return await handleWebhookRequestInner(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[events] unhandled error', {error: message})
    return Response.json({ok: false, error: message}, {status: 500})
  }
}

async function handleWebhookRequestInner(request: Request): Promise<Response> {
  const json = await request.text()
  logger.debug('event received', {url: request.url, text: json.slice(0, 200)})

  const signature = request.headers.get('x-hub-signature-256')
  const isValid = await validateGithubWebhook(signature, json).catch(() => false)
  if (!isValid) {
    logger.warn('invalid signature was sent')
    return Response.json({error: 'invalid signature'}, {status: 400})
  }

  const parsed = AppWebhookEvent.safeParse(JSON.parse(json))
  if (!parsed.success) {
    logger.error('error parsing event', fromError(parsed.error), {json})
    return Response.json({error: fromError(parsed.error).message}, {status: 500})
  }

  const event = parsed.data
  return logger.run([`event=${event.eventType}`, `action=${event.action}`], async () => {
    return handleEvent(request, parsed.data)
  })
}

async function handleEvent(request: Request, event: AppWebhookEvent) {
  if (event.eventType === 'installation_added') {
    const addedRepos = event.installation.repositories_added.map(r => {
      const [owner, name] = r.full_name.split('/')
      return {owner, name}
    })
    const createdRepos = await Promise.all(
      addedRepos.map(repo => {
        return storeInstallationAndRepo({owner: repo.owner, repo: repo.name, installationId: event.installation.id})
      }),
    )
    captureServerEvent({
      distinctId: event.installation.id.toString(),
      event: 'installation_created',
      properties: {
        githubInstallationId: event.installation.id,
        dbInstallationId: createdRepos[0]?.dbInstallationId,
        repos: event.installation.repositories_added.map(r => r.full_name).join(','),
      },
    })
    return Response.json({ok: true, action: event.action, eventType: event.eventType, createdRepos})
  }

  if (event.eventType === 'installation_removed') {
    const db = getDb()
    const rows = await db.sql.all<{id: string; github_id: number}>`
      update github_installations
      set removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      where github_id = ${event.installation.id}
      returning id, github_id
    `
    const removedInstallation = rows[0]
    captureServerEvent({
      distinctId: event.installation.id.toString(),
      event: 'installation_removed',
      properties: {
        githubInstallationId: event.installation.id,
        dbInstallationId: removedInstallation?.id,
        repos: event.installation.repositories_removed.map(r => r.full_name).join(','),
      },
    })
    return Response.json({ok: true, action: event.action, eventType: event.eventType, removedInstallation})
  }

  if (event.eventType === 'workflow_job_not_completed' || event.eventType === 'unknown_action') {
    return Response.json({ok: true, action: event.action, eventType: event.eventType})
  }

  if (event.eventType !== 'workflow_job_completed') {
    event satisfies never
    logger.warn('unknown event type')
    return Response.json({ok: false, error: 'unexpected body', keys: Object.keys(event)}, {status: 500})
  }

  return logger.run(`job=${event.workflow_job.name}`, async () => {
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

    const dedupedArtifacts = Object.values(Object.fromEntries(data.artifacts.map(a => [a.name, a])))

    const origin = getArtifactOrigin(request)
    const artifacts = await Promise.all(
      dedupedArtifacts.map(async a => {
        return logger.run(`artifact=${a.name}`, async () => {
          await storeInstallationAndRepo({owner, repo, installationId: event.installation.id})

          const txResult = await insertArtifactRecord({
            owner,
            repo,
            job,
            artifact: {...a, aliasTypes: ['run', 'sha', 'branch']},
            installation: event.installation,
          })

          return {
            name: a.name,
            artifactId: txResult.dbArtifact.id,
            links: txResult.dbIdentifiers.map(({type: aliasType, value: identifier}) => ({
              aliasType,
              url: origin + toAppArtifactPath({owner, repo, aliasType, identifier, artifactName: a.name}),
            })),
          }
        })
      }),
    )

    const jobsCompleted = jobsForRun.jobs.filter(j => j.status === 'completed').length
    const summaries = artifacts.map(arti => {
      return `- **${arti.name}**: ${arti.links.map(i => `[${i.aliasType}](${i.url})`).join(' / ')}`
    })
    const hostname = new URL(origin).hostname
    if (artifacts.length === 1 && jobsForRun.total_count === jobsCompleted) {
      await octokit.rest.checks.create({
        owner,
        repo,
        name: hostname,
        details_url: artifacts[0].links[0].url,
        output: {
          title: `${artifacts[0].name}`,
          summary: `artifact ready to view`,
          text: summaries.join('\n'),
        },
        head_sha: event.workflow_job.head_sha,
        conclusion: 'success',
      })
    } else if (artifacts.length > 0) {
      const output = {
        title: `${artifacts.length} artifacts (${jobsCompleted} of ${jobsForRun.total_count} jobs completed)`,
        summary: 'The following artifacts are ready to view',
        text: summaries.join('\n'),
      }
      await octokit.rest.checks.create({
        owner,
        repo,
        name: hostname,
        head_sha: event.workflow_job.head_sha,
        conclusion: 'success',
        output,
      })
    }
    return Response.json({ok: true, total: data.total_count, artifacts})
  })
}
