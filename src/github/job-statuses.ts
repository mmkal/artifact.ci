import {Octokit} from '@octokit/rest'
import * as cheerio from 'cheerio'
import {type GithubActionsContext} from '../types'

export async function getJobsWithStatuses(context: GithubActionsContext, params: {githubToken: string | null}) {
  if (params.githubToken) return getJobsWithStatusesViaApi(context, params)
  return getJobsWithStatusesViaWeb(context)
}

async function getJobsWithStatusesViaApi(context: GithubActionsContext, params: {githubToken: string | null}) {
  const github = new Octokit({auth: params.githubToken})
  const [owner, repo] = context.repository.split('/')
  const response = await github.rest.actions
    .listJobsForWorkflowRun({
      owner,
      repo,
      run_id: context.runId,
      baseUrl: context.githubOrigin,
    })
    .catch(e => new Error(`Failed to list jobs`, {cause: e}))

  if (response instanceof Error) {
    return {outcome: 'api_failure', response} as const
  }

  const jobs = Object.fromEntries(
    response.data.jobs.map(job => {
      let status: 'running' | 'success' | 'failed' | 'unexpected' = 'running'
      if (job.status === 'in_progress') status = 'running'
      else if (job.status === 'completed' && job.conclusion === 'success') status = 'success'
      else if (job.status === 'completed' && job.conclusion === 'failure') status = 'failed'
      else status = 'unexpected'

      return [job.id, {href: job.html_url, jobId: job.id, jobName: job.name, status}]
    }),
  )
  return {outcome: 'success', jobs} as const
}

/** Fetches a `run` page as ✨HTML✨ and parses to get the statuses of all jobs! */
export async function getJobsWithStatusesViaWeb(context: GithubActionsContext) {
  const [owner, repo] = context.repository.split('/')

  const runPathname = `/${owner}/${repo}/actions/runs/${context.runId}`
  const runPageUrl = `${context.githubOrigin}${runPathname}`
  const res = await fetch(runPageUrl)
  if (!res.ok) {
    return {outcome: 'fetch_failure', response: res} as const
  }
  return {
    success: true,
    jobs: parseJobStatuses(await res.text()),
  } as const
}

export function parseJobStatuses(runPageHtml: string) {
  const $ = cheerio.load(runPageHtml)

  const jobAnchors = $(`streaming-graph-job[data-job-id]`)
  const jobs = jobAnchors.map((_, el) => {
    const $el = $(el)
    const isRunning = $el.find('svg[aria-label*="currently running"]').length > 0
    const isFailed = $el.find('svg[aria-label*="failed"]').length > 0
    const isSuccess = $el.find('svg[aria-label*="completed successfully"]').length > 0
    const checks = {running: isRunning, failed: isFailed, success: isSuccess}
    if (Object.values(checks).filter(Boolean).length !== 1) {
      throw new Error(`Job status is ambiguous: ${JSON.stringify(checks)}`)
    }
    const status = Object.keys(checks).find(key => checks[key]) as keyof typeof checks
    const jobId = $el.attr('data-job-id')
    const jobName = $el.find('[data-target="streaming-graph-job.name"]').text().trim()
    const href = $el.find(`a[id="workflow-job-name-${jobId}"]`).attr('href')
    return {href, jobId, jobName, status}
  })

  return {outcome: 'success', jobs: Object.fromEntries(jobs.toArray().map(a => [a.jobId!, a]))}
}
