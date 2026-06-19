import {getCollaborationLevel} from '@artifact/domain/github/access'
import {getInstallationOctokit, lookupRepoInstallation} from '@artifact/domain/github/installations'
import {TRPCError} from '@trpc/server'
import {type Octokit} from 'octokit'
import {z} from 'zod'
import {insertArtifactRecord} from '../github/upload'
import {summarizeUploadArtifactLog, type UploadArtifactLogSummary} from './github-log-diagnostics'

const maxRuns = 5
const maxPrCommitsToCheck = 10
const maxJobLogsToCheck = 8

export const ArtifactDiagnosticInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  aliasType: z.string().min(1),
  identifier: z.string().min(1),
})

export type ArtifactDiagnosticInput = z.infer<typeof ArtifactDiagnosticInput>

export type ArtifactDiagnosticResult = {
  checkedAt: string
  owner: string
  repo: string
  aliasType: string
  identifier: string
  notes: string[]
  runs: Array<{
    id: number
    runAttempt: number
    name: string
    status: string | null
    conclusion: string | null
    event: string
    headSha: string
    headBranch: string | null
    htmlUrl: string
    createdAt: string | null
    updatedAt: string | null
    artifactTotal: number
    artifacts: Array<{
      id: number
      name: string
      expired: boolean
      expiresAt: string | null
      recorded: boolean
      recordError: string | null
    }>
    jobs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      htmlUrl: string
      uploadArtifact: UploadArtifactLogSummary | null
      logStatus: 'checked' | 'unavailable' | 'skipped'
      logMessage: string | null
    }>
  }>
}

export async function diagnoseArtifactRequest(
  input: ArtifactDiagnosticInput & {githubLogin: string | null | undefined},
): Promise<ArtifactDiagnosticResult> {
  if (!input.githubLogin) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Sign in to check GitHub again.'})

  const installation = await lookupRepoInstallation(input.owner, input.repo).catch(() => null)
  if (!installation) {
    throw new TRPCError({code: 'NOT_FOUND', message: 'GitHub App installation was not found for this repository.'})
  }
  const octokit = await getInstallationOctokit(installation.id)
  const level = await getCollaborationLevel(octokit, {
    owner: input.owner,
    repo: input.repo,
    username: input.githubLogin,
  }).catch(() => 'none')
  if (level === 'none') throw new TRPCError({code: 'UNAUTHORIZED', message: 'GitHub access was not confirmed.'})

  const notes: string[] = []
  const runs = await findRunsForDiagnostic({octokit, ...input, notes})
  if (runs.length === 0) notes.push('No matching workflow runs were found through the GitHub API.')

  let checkedJobLogs = 0
  const diagnosticRuns: ArtifactDiagnosticResult['runs'] = []
  for (const run of runs.slice(0, maxRuns)) {
    const artifactsResponse = await octokit.rest.actions
      .listWorkflowRunArtifacts({owner: input.owner, repo: input.repo, run_id: run.id, per_page: 100})
      .catch(error => {
        notes.push(`Could not list artifacts for run ${run.id}: ${messageFromError(error)}`)
        return null
      })
    const artifacts = artifactsResponse?.data.artifacts || []
    const jobsResponse = await octokit.rest.actions
      .listJobsForWorkflowRun({owner: input.owner, repo: input.repo, run_id: run.id, per_page: 100})
      .catch(error => {
        notes.push(`Could not list jobs for run ${run.id}: ${messageFromError(error)}`)
        return null
      })

    diagnosticRuns.push({
      id: run.id,
      runAttempt: run.run_attempt || 1,
      name: run.name || `run ${run.id}`,
      status: run.status || null,
      conclusion: run.conclusion || null,
      event: run.event || '',
      headSha: run.head_sha || '',
      headBranch: run.head_branch || null,
      htmlUrl: run.html_url || '',
      createdAt: run.created_at || null,
      updatedAt: run.updated_at || null,
      artifactTotal: artifactsResponse?.data.total_count || artifacts.length,
      artifacts: await Promise.all(
        artifacts.map(async artifact => {
          let recorded = false
          let recordError: string | null = null
          if (!artifact.expired) {
            try {
              await insertArtifactRecord({
                owner: input.owner,
                repo: input.repo,
                job: {
                  head_sha: run.head_sha || '',
                  head_branch: run.head_branch || '',
                  run_id: run.id,
                  run_attempt: run.run_attempt || 1,
                },
                artifact: {
                  id: artifact.id,
                  name: artifact.name,
                  aliasTypes: ['run', 'sha', 'branch'],
                },
                installation,
              })
              recorded = true
            } catch (error) {
              recordError = messageFromError(error)
            }
          }
          return {
            id: artifact.id,
            name: artifact.name,
            expired: Boolean(artifact.expired),
            expiresAt: artifact.expires_at || null,
            recorded,
            recordError,
          }
        }),
      ),
      jobs: await Promise.all(
        (jobsResponse?.data.jobs || []).slice(0, 20).map(async job => {
          if (checkedJobLogs >= maxJobLogsToCheck) {
            return toDiagnosticJob(job, {
              logStatus: 'skipped',
              uploadArtifact: null,
              logMessage: 'log check limit reached',
            })
          }
          checkedJobLogs += 1
          const logResult = await downloadJobLogText({
            octokit,
            owner: input.owner,
            repo: input.repo,
            jobId: job.id,
          })
          if (!logResult.ok) {
            return toDiagnosticJob(job, {logStatus: 'unavailable', uploadArtifact: null, logMessage: logResult.message})
          }
          return toDiagnosticJob(job, {
            logStatus: 'checked',
            uploadArtifact: summarizeUploadArtifactLog(logResult.text),
            logMessage: null,
          })
        }),
      ),
    })
  }

  return {
    checkedAt: new Date().toISOString(),
    owner: input.owner,
    repo: input.repo,
    aliasType: input.aliasType,
    identifier: input.identifier,
    notes,
    runs: diagnosticRuns,
  }
}

async function findRunsForDiagnostic({
  octokit,
  owner,
  repo,
  aliasType,
  identifier,
  notes,
}: ArtifactDiagnosticInput & {octokit: Octokit; notes: string[]}): Promise<WorkflowRun[]> {
  if (aliasType === 'run') {
    const runId = Number(identifier.split('.')[0])
    if (!Number.isInteger(runId) || runId < 1) return []
    const response = await octokit.rest.actions.getWorkflowRun({owner, repo, run_id: runId}).catch((error: unknown) => {
      notes.push(`Could not load run ${runId}: ${messageFromError(error)}`)
      return null
    })
    return response ? [response.data] : []
  }

  if (aliasType === 'sha') {
    const fullSha = await resolveFullSha(octokit, owner, repo, identifier)
    if (!fullSha) {
      notes.push(`Could not resolve SHA ${identifier}.`)
      return []
    }
    return listRunsForSha({octokit, owner, repo, sha: fullSha, notes})
  }

  if (aliasType === 'branch') {
    const branch = identifier.replaceAll('__', '/')
    const response = await octokit.rest.actions
      .listWorkflowRunsForRepo({owner, repo, branch, per_page: maxRuns})
      .catch((error: unknown) => {
        notes.push(`Could not list workflow runs for branch ${branch}: ${messageFromError(error)}`)
        return null
      })
    return response?.data.workflow_runs || []
  }

  if (aliasType === 'pr') {
    const pullNumber = Number(identifier)
    if (!Number.isInteger(pullNumber) || pullNumber < 1) return []
    const pull = await octokit.rest.pulls
      .get({owner, repo, pull_number: pullNumber})
      .then(response => response.data)
      .catch((error: unknown) => {
        notes.push(`Could not load PR ${identifier}: ${messageFromError(error)}`)
        return null
      })
    if (!pull) return []
    const commitsResponse = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    })
    const shas = Array.from(new Set([pull.head.sha, ...commitsResponse.data.map(commit => commit.sha)]))
      .filter(Boolean)
      .reverse()
      .slice(0, maxPrCommitsToCheck)
    const runs = []
    for (const sha of shas) {
      runs.push(...(await listRunsForSha({octokit, owner, repo, sha, notes})))
      if (runs.length >= maxRuns) break
    }
    if (runs.length === 0 && pull.head.ref) {
      notes.push(`No runs found by PR commit SHA; checking branch ${pull.head.ref}.`)
      const response = await octokit.rest.actions
        .listWorkflowRunsForRepo({owner, repo, branch: pull.head.ref, per_page: maxRuns})
        .catch(() => null)
      runs.push(...(response?.data.workflow_runs || []))
    }
    return dedupeRuns(runs)
  }

  notes.push(`Alias type ${aliasType} is not supported by Check again yet.`)
  return []
}

async function listRunsForSha({
  octokit,
  owner,
  repo,
  sha,
  notes,
}: {
  octokit: Octokit
  owner: string
  repo: string
  sha: string
  notes: string[]
}): Promise<WorkflowRun[]> {
  const response = await octokit.rest.actions
    .listWorkflowRunsForRepo({owner, repo, head_sha: sha, per_page: maxRuns})
    .catch((error: unknown) => {
      notes.push(`Could not list workflow runs for ${sha.slice(0, 7)}: ${messageFromError(error)}`)
      return null
    })
  return response?.data.workflow_runs || []
}

async function resolveFullSha(octokit: Octokit, owner: string, repo: string, identifier: string) {
  if (/^[\da-f]{40}$/i.test(identifier)) return identifier
  const response = await octokit.rest.repos.getCommit({owner, repo, ref: identifier}).catch(() => null)
  return response?.data.sha || null
}

function dedupeRuns(runs: WorkflowRun[]) {
  const seen = new Set<number>()
  return runs.filter(run => {
    if (seen.has(run.id)) return false
    seen.add(run.id)
    return true
  })
}

async function downloadJobLogText({
  octokit,
  owner,
  repo,
  jobId,
}: {
  octokit: Octokit
  owner: string
  repo: string
  jobId: number
}): Promise<{ok: true; text: string} | {ok: false; message: string}> {
  const response = await octokit.rest.actions
    .downloadJobLogsForWorkflowRun({owner, repo, job_id: jobId, request: {redirect: 'manual'}})
    .catch((error: unknown) => ({error}))
  if ('error' in response) return {ok: false, message: messageFromError(response.error)}
  if (typeof response.data === 'string') return {ok: true, text: response.data.slice(0, 1_000_000)}

  const location = response.headers.location
  if (!location) return {ok: false, message: 'GitHub did not return a job log URL. Logs may have expired.'}
  const logResponse = await fetch(location).catch((error: unknown) => ({error}))
  if ('error' in logResponse) return {ok: false, message: messageFromError(logResponse.error)}
  if (!logResponse.ok)
    return {ok: false, message: `GitHub log download returned ${logResponse.status}. Logs may have expired.`}
  return {ok: true, text: (await logResponse.text()).slice(0, 1_000_000)}
}

function toDiagnosticJob(
  job: Job,
  log: {
    logStatus: 'checked' | 'unavailable' | 'skipped'
    uploadArtifact: UploadArtifactLogSummary | null
    logMessage: string | null
  },
) {
  return {
    id: job.id,
    name: job.name || `job ${job.id}`,
    status: job.status || '',
    conclusion: job.conclusion || null,
    htmlUrl: job.html_url || '',
    ...log,
  }
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type WorkflowRun = {
  id: number
  run_attempt?: number | null
  name?: string | null
  status?: string | null
  conclusion?: string | null
  event?: string | null
  head_sha?: string | null
  head_branch?: string | null
  html_url?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type Job = {
  id: number
  name?: string | null
  status?: string | null
  conclusion?: string | null
  html_url?: string | null
}
