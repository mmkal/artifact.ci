import {runWithAppEnv, type AppEnv, type D1DatabaseBinding, type D1PreparedStatementBinding} from '../cloudflare-env'

/**
 * Test world for depot flows: real sqlite (via node:sqlite) behind the D1
 * binding interface, plus fake Depot + GitHub + artifact-storage HTTP
 * servers. No mocking of app code — the seams are DEPOT_API_URL and
 * GITHUB_API_URL.
 */
export async function setupDepotSyncWorld(
  options: {
    /** point at the real https://api.depot.dev (with a real token) instead of the fake server */
    depotApiUrl?: string
    depotApiToken?: string
  } = {},
) {
  const {createServer} = await import('node:http')
  const {generateKeyPairSync} = await import('node:crypto')
  const {readFileSync} = await import('node:fs')
  // vite 5's import analysis predates node:sqlite, so resolve it at runtime
  const {DatabaseSync} = process.getBuiltinModule('node:sqlite' as 'fs') as unknown as typeof import('node:sqlite')

  // --- fake artifact storage (stands in for depot's presigned S3 urls)
  const storage = {zips: {} as Record<string, Buffer>}
  const storageServer = createServer((req, res) => {
    const zip = storage.zips[req.url!.split('?')[0]]
    if (!zip) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': String(zip.length)})
    res.end(zip)
  })
  await new Promise<void>(resolve => storageServer.listen(0, resolve))
  const port = (server: import('node:http').Server) => (server.address() as {port: number}).port

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
      } else if (req.url === '/depot.ci.v1.CIService/GetArtifactDownloadURL') {
        const artifact = Object.values(depot.artifacts)
          .flat()
          .find(a => a.artifactId === body.artifactId)
        res.end(
          JSON.stringify({
            artifact,
            url: `http://127.0.0.1:${port(storageServer)}/${body.artifactId}?signature=fake`,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          }),
        )
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

  // --- real schema in an in-memory sqlite db
  const db = new DatabaseSync(':memory:')
  const definitionsSql = readFileSync(new URL('../../../../definitions.sql', import.meta.url), 'utf8')
  db.exec(definitionsSql)
  db.prepare(`insert into depot_connections (id, owner, repo, depot_org_id, api_token) values (?, ?, ?, ?, ?)`).run(
    'depot_connection_test',
    'iterate',
    'iterate',
    '0p91s0lz49',
    options.depotApiToken || 'depot-token',
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
    DEPOT_API_URL: options.depotApiUrl || `http://127.0.0.1:${port(depotServer)}`,
  } as AppEnv

  return {
    depot,
    github,
    storage,
    run: <T>(fn: () => Promise<T>) => runWithAppEnv(appEnv, fn),
    query: (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>,
    exec: (sql: string) => db.exec(sql),
    async [Symbol.asyncDispose]() {
      process.env.GITHUB_APP_ID = savedEnv.GITHUB_APP_ID
      process.env.GITHUB_APP_PRIVATE_KEY = savedEnv.GITHUB_APP_PRIVATE_KEY
      process.env.GITHUB_API_URL = savedEnv.GITHUB_API_URL
      await new Promise(resolve => depotServer.close(resolve))
      await new Promise(resolve => githubServer.close(resolve))
      await new Promise(resolve => storageServer.close(resolve))
    },
  }
}

function createSqliteD1Binding(db: import('node:sqlite').DatabaseSync): D1DatabaseBinding {
  const makeStatement = (query: string, values: unknown[]): D1PreparedStatementBinding => ({
    bind: (...next: unknown[]) => makeStatement(query, next),
    all: async <T>() => {
      const results = db.prepare(query).all(...(values as never[])) as T[]
      return {results, success: true as const, meta: {}}
    },
    first: async <T>(columnName?: string) => {
      const row = db.prepare(query).get(...(values as never[])) as any
      if (!row) return null
      return (columnName ? row[columnName] : row) as T
    },
    run: async () => {
      db.prepare(query).run(...(values as never[]))
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
