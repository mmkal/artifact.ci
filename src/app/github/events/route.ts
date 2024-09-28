import {NextRequest, NextResponse} from 'next/server'
import {App} from 'octokit'
import {z} from 'zod'
import {fromError} from 'zod-validation-error'
import {AppWebhookEvent} from './types'
import {getLogger as getLoggerBase} from '~/logger'

const getLogger = (request: NextRequest) => {
  return getLoggerBase({debug: request.headers.get('artifactci-debug') === 'true'})
}

export async function POST(request: NextRequest) {
  const logger = getLogger(request)
  const body = (await request.json()) as {}
  logger.debug('event received', request.url, body)
  const parsed = AppWebhookEvent.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({error: fromError(parsed.error).message}, {status: 400})
  }

  const env = Env.parse(process.env)
  const app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  })

  const event = parsed.data
  if (event.eventType === 'workflow_job_completed') {
    const [owner, repo] = event.repository.full_name.split('/')
    const octokit = await app.getInstallationOctokit(event.installation.id)
    const {data: artifacts} = await octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: event.workflow_job.run_id,
    })
    logger.info('artifacts', artifacts)
    return NextResponse.json({ok: true, artifacts})
  }

  return NextResponse.json(
    {ok: false, error: 'unknown event type', eventType: event.eventType, action: event.action},
    {status: 400},
  )
}

const Env = z.object({
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
})
