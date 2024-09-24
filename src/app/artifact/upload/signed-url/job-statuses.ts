import * as cheerio from 'cheerio'
import {type GithubActionsContext} from './types'

/** Fetches a `run` page as ✨HTML✨ and parses to get the statuses of all jobs! */
// todo: use github api if token is available
export async function getJobsWithStatuses(context: GithubActionsContext) {
  const [owner, repo] = context.repository.split('/')

  const runPathname = `/${owner}/${repo}/actions/runs/${context.runId}`
  const runPageUrl = `${context.githubOrigin}${runPathname}`
  const res = await fetch(runPageUrl)
  if (!res.ok) {
    return {success: false, response: res} as const
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

  return Object.fromEntries(jobs.toArray().map(a => [a.jobId!, a]))
}
