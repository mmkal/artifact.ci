import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {createPrefixedId} from '@artifact/domain/db/client'
import {createDepotClient, depotRunAliases, type DepotArtifact, type DepotRun} from '@artifact/domain/depot/client'
import {getInstallationOctokit, lookupRepoInstallation} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {getAppEnv, getDb} from '../cloudflare-env'
import {storeInstallationAndRepo} from '../github/upload'

export interface DepotConnectionRow extends Record<string, unknown> {
  id: string
  owner: string
  repo: string
  depot_org_id: string
  api_token: string
}

/** how far back to look for runs; runs older than this are never (re)processed */
const lookbackMs = 48 * 60 * 60 * 1000
const maxRunListPages = 10

export async function syncAllDepotConnections(params: {origin: string}) {
  const db = getDb()
  const connections = await db.sql.all<DepotConnectionRow>`select * from depot_connections`
  const results = []
  for (const connection of connections) {
    const slug = `${connection.owner}/${connection.repo}`
    const result = await logger
      .run(`depot=${slug}`, () => syncDepotConnection(connection, params))
      .catch((error: unknown) => {
        logger.error('[depot-sync] connection failed', {connection: slug, error: String(error)})
        return {error: String(error)}
      })
    results.push({connection: slug, ...result})
  }
  return results
}

export async function syncDepotConnection(connection: DepotConnectionRow, {origin}: {origin: string}) {
  const client = createDepotClientForConnection(connection)
  const cutoff = Date.now() - lookbackMs
  const cutoffIso = new Date(cutoff).toISOString()

  const runs: DepotRun[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxRunListPages; page++) {
    const response = await client.listRuns({
      repo: `${connection.owner}/${connection.repo}`,
      status: ['finished', 'failed', 'cancelled'],
      pageSize: 100,
      ...(pageToken && {pageToken}),
    })
    runs.push(...response.runs)
    const oldestOnPage = response.runs.at(-1)
    if (!response.nextPageToken || !oldestOnPage || new Date(oldestOnPage.createdAt).getTime() < cutoff) break
    pageToken = response.nextPageToken
  }

  const db = getDb()
  const seenRows = await db.sql.all<{depot_run_id: string}>`
    select depot_run_id from depot_runs
    where connection_id = ${connection.id}
      and run_created_at >= ${cutoffIso}
  `
  const seen = new Set(seenRows.map(row => row.depot_run_id))
  const newRuns = runs.filter(
    run => new Date(run.createdAt).getTime() >= cutoff && !seen.has(run.runId) && (run.headSha || run.sha),
  )

  const processed = []
  // oldest first so check runs land in chronological order
  for (const run of newRuns.reverse()) {
    const result = await processDepotRun({connection, client, run, origin}).catch((error: unknown) => {
      // don't record the run as processed: the next sync retries it (inserts are idempotent upserts)
      logger.error('[depot-sync] run failed', {runId: run.runId, error: String(error)})
      return {runId: run.runId, error: String(error)}
    })
    processed.push(result)
  }
  return {runsChecked: runs.length, processed}
}

async function processDepotRun(params: {
  connection: DepotConnectionRow
  client: ReturnType<typeof createDepotClientForConnection>
  run: DepotRun
  origin: string
}) {
  const {connection, client, run, origin} = params
  const {owner, repo} = connection
  const headSha = (run.headSha || run.sha)!

  const artifacts: DepotArtifact[] = []
  let pageToken: string | undefined
  do {
    const response = await client.listArtifacts({runId: run.runId, pageSize: 100, ...(pageToken && {pageToken})})
    artifacts.push(...response.artifacts)
    pageToken = response.nextPageToken
  } while (pageToken)

  // artifact names can repeat across jobs in one run; last upload wins, same as the webhook flow
  const dedupedArtifacts = Object.values(Object.fromEntries(artifacts.map(a => [a.name, a])))

  const recorded = []
  if (dedupedArtifacts.length > 0) {
    const installation = await lookupRepoInstallation(owner, repo)
    if (!installation) throw new Error(`github app installation not found for ${owner}/${repo}`)
    await storeInstallationAndRepo({owner, repo, installationId: installation.id})

    const aliases = depotRunAliases(run)
    for (const artifact of dedupedArtifacts) {
      const links = await insertDepotArtifactRecord({owner, repo, artifact, aliases, installationId: installation.id})
      recorded.push({
        name: artifact.name,
        links: links.map(({type: aliasType, value: identifier}) => ({
          aliasType,
          url: origin + toAppArtifactPath({owner, repo, aliasType, identifier, artifactName: artifact.name}),
        })),
      })
    }

    const octokit = await getInstallationOctokit(installation.id)
    const hostname = new URL(origin).hostname
    const summaries = recorded.map(artifact => {
      return `- **${artifact.name}**: ${artifact.links.map(link => `[${link.aliasType}](${link.url})`).join(' / ')}`
    })
    await octokit.rest.checks.create({
      owner,
      repo,
      name: hostname,
      head_sha: headSha,
      conclusion: 'success',
      details_url: recorded[0].links[0]?.url,
      output:
        recorded.length === 1
          ? {title: recorded[0].name, summary: 'artifact ready to view', text: summaries.join('\n')}
          : {
              title: `${recorded.length} artifacts`,
              summary: 'The following artifacts are ready to view',
              text: summaries.join('\n'),
            },
    })
  }

  const db = getDb()
  await db.sql.all`
    insert into depot_runs (id, connection_id, depot_run_id, head_sha, ref, status, artifact_count, run_created_at)
    values (${createPrefixedId('depot_run')}, ${connection.id}, ${run.runId}, ${headSha}, ${run.ref || null}, ${run.status}, ${dedupedArtifacts.length}, ${run.createdAt})
    on conflict (depot_run_id) do update set
      status = excluded.status,
      artifact_count = excluded.artifact_count,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `

  return {runId: run.runId, artifacts: recorded.map(r => r.name)}
}

async function insertDepotArtifactRecord(params: {
  owner: string
  repo: string
  artifact: DepotArtifact
  aliases: Array<{type: string; value: string}>
  installationId: number
}) {
  const {owner, repo, artifact, aliases, installationId} = params
  const db = getDb()
  const repoRows = await db.sql.all<{repo_id: string; default_visibility: string; installation_id: string}>`
    select r.id as repo_id, r.default_visibility, gi.id as installation_id
    from repos r
    join github_installations gi on gi.github_id = ${installationId}
    where r.owner = ${owner}
      and r.name = ${repo}
    limit 1
  `
  const dbRepo = repoRows[0]
  if (!dbRepo) throw new Error(`repo ${owner}/${repo} was not stored before depot artifact insert`)

  const d1 = getAppEnv().ARTIFACT_DB
  const statements = [
    d1
      .prepare(
        `
          insert into artifacts (id, repo_id, name, depot_artifact_id, installation_id, visibility)
          values (?, ?, ?, ?, ?, ?)
          on conflict (repo_id, name, depot_artifact_id) where depot_artifact_id is not null do update set
            installation_id = excluded.installation_id,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          returning id
        `,
      )
      .bind(
        createPrefixedId('artifact'),
        dbRepo.repo_id,
        artifact.name,
        artifact.artifactId,
        dbRepo.installation_id,
        dbRepo.default_visibility,
      ),
    ...aliases.map(alias =>
      d1
        .prepare(
          `
            insert into artifact_identifiers (id, artifact_id, type, value)
            values (?, (select id from artifacts where repo_id = ? and name = ? and depot_artifact_id = ?), ?, ?)
            on conflict (artifact_id, type, value) do update set
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            returning type, value
          `,
        )
        .bind(
          createPrefixedId('artifact_identifier'),
          dbRepo.repo_id,
          artifact.name,
          artifact.artifactId,
          alias.type,
          alias.value,
        ),
    ),
  ]
  const results = await d1.batch(statements)
  if (!results[0]?.results[0]) throw new Error(`depot artifact ${artifact.artifactId} was not stored`)
  return results.slice(1).flatMap(result => result.results as Array<{type: string; value: string}>)
}

export function createDepotClientForConnection(connection: DepotConnectionRow) {
  const env = getAppEnv()
  return createDepotClient({
    apiToken: connection.api_token,
    orgId: connection.depot_org_id,
    ...(env.DEPOT_API_URL && {baseUrl: env.DEPOT_API_URL}),
  })
}

export async function findDepotConnection(owner: string, repo: string): Promise<DepotConnectionRow | null> {
  const db = getDb()
  const rows = await db.sql.all<DepotConnectionRow>`
    select * from depot_connections where owner = ${owner} and repo = ${repo} limit 1
  `
  return rows[0] || null
}
