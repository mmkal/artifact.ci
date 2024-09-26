import {Octokit} from '@octokit/rest'
import * as cheerio from 'cheerio'
import {type GithubActionsContext} from '../types'

export type JobInfo = {
  href: string
  jobId: string | null
  jobName: string
  status: 'running' | 'success' | 'failed' | 'unexpected'
}
export type GetJobsWithStatusesResult =
  | {
      mode: 'api' | 'web'
      outcome: 'success'
      jobs: JobInfo[]
    }
  | {
      mode: 'api'
      outcome: 'failure'
      response: Error
    }
  | {
      mode: 'web'
      outcome: 'failure'
      response: Response
    }

export async function getJobsWithStatuses(
  context: GithubActionsContext,
  params: {githubToken: string | null},
): Promise<GetJobsWithStatusesResult> {
  if (params.githubToken) return getJobsWithStatusesViaApi(context, params)
  return getJobsWithStatusesViaWeb(context)
}

async function getJobsWithStatusesViaApi(
  context: GithubActionsContext,
  params: {githubToken: string | null},
): Promise<GetJobsWithStatusesResult> {
  const github = new Octokit({auth: params.githubToken})
  const [owner, repo] = context.repository.split('/')
  const workflowRuns = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'recipes.yml',
    head_sha: '4b36d7f82d8005b9d54860d2999720c424873061',
  })
  console.log('workflowRuns', workflowRuns.data)
  const response = await github.rest.actions
    .listJobsForWorkflowRun({
      owner,
      repo,
      run_id: context.runId,
      // baseUrl: context.githubOrigin, // need githubApiBaseUrl
    })
    .catch(e => new Error(`Failed to list jobs for run ${context.runId}`, {cause: e}))

  if (response instanceof Error) {
    return {mode: 'api', outcome: 'failure', response} as const
  }

  const jobs = response.data.jobs.map((job): JobInfo => {
    let status: 'running' | 'success' | 'failed' | 'unexpected' = 'running'
    if (job.status === 'in_progress') status = 'running'
    else if (job.status === 'completed' && job.conclusion === 'success') status = 'success'
    else if (job.status === 'completed' && job.conclusion === 'failure') status = 'failed'
    else status = 'unexpected'

    if (job.name.includes('Pee')) console.log('job', job)

    return {href: job.html_url!.slice(), jobId: null, jobName: job.name, status}
  })
  return {mode: 'api', outcome: 'success', jobs} as const
}

/** Fetches a `run` page as ✨HTML✨ and parses to get the statuses of all jobs! */
export async function getJobsWithStatusesViaWeb(context: GithubActionsContext): Promise<GetJobsWithStatusesResult> {
  const [owner, repo] = context.repository.split('/')

  const runPathname = `/${owner}/${repo}/actions/runs/${context.runId}`
  const runPageUrl = `${context.githubOrigin}${runPathname}`
  const res = await fetch(runPageUrl)
  if (!res.ok) {
    return {mode: 'web', outcome: 'failure', response: res} as const
  }
  return {
    mode: 'web',
    outcome: 'success',
    jobs: parseJobStatuses(await res.text()),
  } as const
}

export function parseJobStatuses(runPageHtml: string): JobInfo[] {
  const $ = cheerio.load(runPageHtml)

  const jobAnchors = $(`streaming-graph-job[data-job-id]`)
  const jobs = jobAnchors.map((_, el): JobInfo => {
    const $el = $(el)

    const isRunning = $el.find('svg[aria-label*="currently running"]').length > 0
    const isFailed = $el.find('svg[aria-label*="failed"]').length > 0
    const isSuccess = $el.find('svg[aria-label*="completed successfully"]').length > 0

    const checks = {running: isRunning, failed: isFailed, success: isSuccess}
    if (Object.values(checks).filter(Boolean).length !== 1) {
      throw new Error(`Job status is ambiguous: ${JSON.stringify(checks)}`)
    }

    return {
      href: $el.find('a').attr('href')!.slice(),
      jobId: $el.attr('data-job-id')!.slice(),
      jobName: $el.find('[data-target="streaming-graph-job.name"]').text().trim(),
      status: Object.keys(checks).find(key => checks[key]) as keyof typeof checks,
    }
  })

  return jobs.toArray()
}
