import {z} from 'zod'

/**
 * Minimal client for Depot CI's Connect-RPC JSON API (`depot.ci.v1.CIService`).
 * Endpoint shapes come from the protobuf definitions in https://github.com/depot/cli
 * (pkg/proto/depot/ci/v1) — the same RPCs `depot ci artifacts list/download` use.
 */

export const DepotRun = z.object({
  runId: z.string(),
  repo: z.string(),
  trigger: z.string().optional(),
  status: z.string(),
  createdAt: z.string(),
  // full sha of the commit the run executed against (merge commit for PRs)
  sha: z.string().optional(),
  // sha of the head commit (what check runs should be reported on)
  headSha: z.string().optional(),
  // e.g. "refs/heads/main" or "refs/pull/123/merge"
  ref: z.string().optional(),
})
export type DepotRun = z.infer<typeof DepotRun>

export const DepotArtifact = z.object({
  artifactId: z.string(),
  runId: z.string(),
  workflowPath: z.string().optional(),
  jobKey: z.string().optional(),
  attempt: z.number().optional(),
  name: z.string(),
  // int64s are serialized as strings in connect JSON
  sizeBytes: z.coerce.number().optional(),
  createdAt: z.string(),
})
export type DepotArtifact = z.infer<typeof DepotArtifact>

// connect JSON omits empty repeated fields, hence the fallbacks below
const ListRunsResponse = z.object({
  runs: z.array(DepotRun).optional(),
  nextPageToken: z.string().optional(),
})

const ListArtifactsResponse = z.object({
  artifacts: z.array(DepotArtifact).optional(),
  nextPageToken: z.string().optional(),
})

const GetArtifactDownloadURLResponse = z.object({
  artifact: DepotArtifact,
  /** short-lived (~5 min) presigned HTTPS URL for the artifact zip. Note: no CORS — fetch it server-side. */
  url: z.string(),
  expiresAt: z.string().optional(),
})

export interface DepotClientParams {
  apiToken: string
  orgId: string
  /** override for tests/local fakes; the real API is https://api.depot.dev */
  baseUrl?: string
}

export type DepotClient = ReturnType<typeof createDepotClient>

export function createDepotClient({apiToken, orgId, baseUrl = 'https://api.depot.dev'}: DepotClientParams) {
  async function rpc<T>(method: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, '')}/depot.ci.v1.CIService/${method}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'x-depot-org': orgId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`depot ${method} failed: ${response.status} ${text.slice(0, 500)}`)
    }
    return schema.parse(JSON.parse(text))
  }

  return {
    async listRuns(params: {
      repo: string
      status: string[]
      sha?: string
      pr?: string
      pageSize?: number
      pageToken?: string
    }) {
      const response = await rpc('ListRuns', params, ListRunsResponse)
      return {runs: response.runs || [], nextPageToken: response.nextPageToken}
    },
    async listArtifacts(params: {runId: string; pageSize?: number; pageToken?: string}) {
      const response = await rpc('ListArtifacts', params, ListArtifactsResponse)
      return {artifacts: response.artifacts || [], nextPageToken: response.nextPageToken}
    },
    getArtifactDownloadUrl(params: {artifactId: string}) {
      return rpc('GetArtifactDownloadURL', params, GetArtifactDownloadURLResponse)
    },
  }
}

/** aliases artifact.ci should register for a depot run, matching the shapes used for GitHub runs */
export function depotRunAliases(run: DepotRun): Array<{type: 'run' | 'sha' | 'branch'; value: string}> {
  const aliases: Array<{type: 'run' | 'sha' | 'branch'; value: string}> = [{type: 'run', value: run.runId}]
  const headSha = run.headSha || run.sha
  if (headSha) aliases.push({type: 'sha', value: headSha.slice(0, 7)})
  const branchMatch = run.ref?.match(/^refs\/heads\/(.+)$/)
  if (branchMatch) aliases.push({type: 'branch', value: branchMatch[1].replaceAll('/', '__')})
  return aliases
}
