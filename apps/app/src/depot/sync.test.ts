import {expect, test} from 'vitest'
import {runWithAppEnv, type AppEnv, type D1DatabaseBinding, type D1PreparedStatementBinding} from '../cloudflare-env'
import {syncAllDepotConnections} from './sync'

test('sync records depot artifacts with aliases and posts a check run', async () => {
  await using world = await setupDepotSyncWorld()
  world.depot.runs = [
    {
      runId: 'kq2b8fnqkq',
      repo: 'iterate/iterate',
      trigger: 'pull_request',
      status: 'finished',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      sha: '3c22e5906c364fd5c79ec859ff7e5b7e3c5a4460',
      headSha: '9e4a363f9d7170d6428ea6c00a5795ff4ac657c0',
      ref: 'refs/pull/1758/merge',
    },
  ]
  world.depot.artifacts.kq2b8fnqkq = [
    {
      artifactId: '019f4231-2a2b-7db7-ac8b-7cd9d1bf1f0e',
      runId: 'kq2b8fnqkq',
      name: 'preview-os-test-artifacts',
      sizeBytes: '349',
      createdAt: new Date().toISOString(),
    },
  ]

  const results = await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))

  expect(results).toMatchObject([
    {
      connection: 'iterate/iterate',
      processed: [{runId: 'kq2b8fnqkq', artifacts: ['preview-os-test-artifacts']}],
    },
  ])

  const artifacts = world.query(`
    select a.name, a.depot_artifact_id, a.github_id, r.owner
    from artifacts a join repos r on r.id = a.repo_id
  `)
  expect(artifacts).toMatchObject([
    {
      name: 'preview-os-test-artifacts',
      depot_artifact_id: '019f4231-2a2b-7db7-ac8b-7cd9d1bf1f0e',
      github_id: null,
      owner: 'iterate',
    },
  ])

  const identifiers = world.query(`select type, value from artifact_identifiers order by type`)
  expect(identifiers).toEqual([
    {type: 'run', value: 'kq2b8fnqkq'},
    {type: 'sha', value: '9e4a363'},
  ])

  expect(world.github.checkRuns).toMatchObject([
    {
      name: 'artifact.ci',
      head_sha: '9e4a363f9d7170d6428ea6c00a5795ff4ac657c0',
      conclusion: 'success',
      details_url: 'https://artifact.ci/artifact/view/iterate/iterate/run/kq2b8fnqkq/preview-os-test-artifacts',
      output: {title: 'preview-os-test-artifacts'},
    },
  ])

  const depotRuns = world.query(`select depot_run_id, status, artifact_count from depot_runs`)
  expect(depotRuns).toEqual([{depot_run_id: 'kq2b8fnqkq', status: 'finished', artifact_count: 1}])
})

test('sync is idempotent: a second pass records and posts nothing new', async () => {
  await using world = await setupDepotSyncWorld()
  world.depot.runs = [
    {
      runId: 'n56l2xfdb8',
      repo: 'iterate/iterate',
      status: 'finished',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      headSha: '35db0be3d154cc2800129293289a56fe9455c400',
      ref: 'refs/heads/main',
    },
  ]
  world.depot.artifacts.n56l2xfdb8 = [
    {
      artifactId: '019f422f-e463-7f1f-bc1d-e5b8bfb14c1d',
      runId: 'n56l2xfdb8',
      name: 'coverage',
      createdAt: new Date().toISOString(),
    },
  ]

  await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))
  await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))

  expect(world.query(`select count(*) as n from artifacts`)).toEqual([{n: 1}])
  expect(world.query(`select type, value from artifact_identifiers order by type`)).toEqual([
    {type: 'branch', value: 'main'},
    {type: 'run', value: 'n56l2xfdb8'},
    {type: 'sha', value: '35db0be'},
  ])
  expect(world.github.checkRuns).toHaveLength(1)
})

test('runs with no artifacts are recorded but produce no check run', async () => {
  await using world = await setupDepotSyncWorld()
  world.depot.runs = [
    {
      runId: '07qwbk1s76',
      repo: 'iterate/iterate',
      status: 'failed',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      headSha: 'a863293fd2f7abb40eaf994b0d0e663c8b5b98ab',
    },
  ]

  await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))

  expect(world.query(`select count(*) as n from artifacts`)).toEqual([{n: 0}])
  expect(world.query(`select depot_run_id, artifact_count from depot_runs`)).toEqual([
    {depot_run_id: '07qwbk1s76', artifact_count: 0},
  ])
  expect(world.github.checkRuns).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// world setup: real sqlite (via node:sqlite) behind the D1 binding interface,
// plus fake Depot + GitHub HTTP servers. No mocking of app code.
// ---------------------------------------------------------------------------

async function setupDepotSyncWorld() {
  const {createServer} = await import('node:http')
  const {generateKeyPairSync} = await import('node:crypto')
  const {readFileSync} = await import('node:fs')
  // vite 5's import analysis predates node:sqlite, so resolve it at runtime
  const {DatabaseSync} = process.getBuiltinModule('node:sqlite' as 'fs') as unknown as typeof import('node:sqlite')

  // --- fake depot api
  const depot = {
    runs: [] as any[],
    artifacts: {} as Record<string, any[]>,
  }
  const depotServer = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const body = JSON.parse(raw)
      res.writeHead(200, {'content-type': 'application/json'})
      if (req.url === '/depot.ci.v1.CIService/ListRuns') {
        res.end(JSON.stringify({runs: depot.runs.filter(r => body.status.includes(r.status))}))
      } else if (req.url === '/depot.ci.v1.CIService/ListArtifacts') {
        res.end(JSON.stringify({artifacts: depot.artifacts[body.runId] || []}))
      } else {
        res.end(JSON.stringify({}))
      }
    })
  })
  await new Promise<void>(resolve => depotServer.listen(0, resolve))

  // --- fake github api
  const github = {checkRuns: [] as any[]}
  const githubServer = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      res.writeHead(200, {'content-type': 'application/json'})
      if (req.url === '/repos/iterate/iterate/installation') {
        res.end(JSON.stringify({id: 555, app_id: 1}))
      } else if (req.url === '/app/installations/555/access_tokens') {
        res.end(JSON.stringify({token: 'fake-installation-token'}))
      } else if (req.url === '/repos/iterate/iterate/check-runs') {
        github.checkRuns.push(JSON.parse(raw))
        res.end(JSON.stringify({id: github.checkRuns.length}))
      } else {
        res.end(JSON.stringify({}))
      }
    })
  })
  await new Promise<void>(resolve => githubServer.listen(0, resolve))
  const port = (server: import('node:http').Server) => (server.address() as {port: number}).port

  // --- real schema in an in-memory sqlite db
  const db = new DatabaseSync(':memory:')
  const definitionsSql = readFileSync(new URL('../../../../definitions.sql', import.meta.url), 'utf8')
  db.exec(definitionsSql)
  db.prepare(`insert into depot_connections (id, owner, repo, depot_org_id, api_token) values (?, ?, ?, ?, ?)`).run(
    'depot_connection_test',
    'iterate',
    'iterate',
    '0p91s0lz49',
    'depot-token',
  )

  // --- env plumbing
  const {privateKey} = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
  })
  const savedEnv = {...process.env}
  process.env.GITHUB_APP_ID = '12345'
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey as unknown as string
  process.env.GITHUB_API_URL = `http://127.0.0.1:${port(githubServer)}`

  const appEnv = {
    ARTIFACT_DB: createSqliteD1Binding(db),
    DEPOT_API_URL: `http://127.0.0.1:${port(depotServer)}`,
  } as AppEnv

  return {
    depot,
    github,
    run: <T>(fn: () => Promise<T>) => runWithAppEnv(appEnv, fn),
    query: (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>,
    async [Symbol.asyncDispose]() {
      process.env.GITHUB_APP_ID = savedEnv.GITHUB_APP_ID
      process.env.GITHUB_APP_PRIVATE_KEY = savedEnv.GITHUB_APP_PRIVATE_KEY
      process.env.GITHUB_API_URL = savedEnv.GITHUB_API_URL
      await new Promise(resolve => depotServer.close(resolve))
      await new Promise(resolve => githubServer.close(resolve))
    },
  }
}

function createSqliteD1Binding(db: import('node:sqlite').DatabaseSync): D1DatabaseBinding {
  const makeStatement = (query: string, values: unknown[]): D1PreparedStatementBinding => ({
    bind: (...next: unknown[]) => makeStatement(query, next),
    all: async <T>() => {
      const results = db.prepare(query).all(...(values as any[])) as T[]
      return {results, success: true as const, meta: {}}
    },
    first: async <T>(columnName?: string) => {
      const row = db.prepare(query).get(...(values as any[])) as any
      if (!row) return null
      return (columnName ? row[columnName] : row) as T
    },
    run: async () => {
      db.prepare(query).run(...(values as any[]))
      return {results: [], success: true as const, meta: {}}
    },
  })
  return {
    prepare: (query: string) => makeStatement(query, []),
    batch: async <T>(statements: D1PreparedStatementBinding[]) =>
      Promise.all(statements.map(statement => statement.all<T>())),
    exec: async (sql: string) => db.exec(sql),
  }
}
