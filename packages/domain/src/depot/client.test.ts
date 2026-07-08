import {expect, test} from 'vitest'
import {createDepotClient, depotRunAliases} from './client'

test('client calls connect endpoints with auth and org headers', async () => {
  await using fake = await startFakeDepotApi({
    '/depot.ci.v1.CIService/ListRuns': {
      runs: [
        {
          runId: '07qwbk1s76',
          repo: 'iterate/iterate',
          trigger: 'pull_request',
          sha: '9f1248362a69524e7e88fb134127a1d0acda66d0',
          headSha: 'a863293fd2f7abb40eaf994b0d0e663c8b5b98ab',
          ref: 'refs/pull/1758/merge',
          status: 'finished',
          createdAt: '2026-07-08T14:38:42Z',
        },
      ],
      nextPageToken: 'abc',
    },
  })

  const client = createDepotClient({apiToken: 'tok123', orgId: 'org456', baseUrl: fake.url})
  const result = await client.listRuns({repo: 'iterate/iterate', status: ['finished']})

  expect(result).toMatchObject({
    runs: [{runId: '07qwbk1s76', headSha: 'a863293fd2f7abb40eaf994b0d0e663c8b5b98ab'}],
    nextPageToken: 'abc',
  })
  expect(fake.requests[0]).toMatchObject({
    path: '/depot.ci.v1.CIService/ListRuns',
    headers: {authorization: 'Bearer tok123', 'x-depot-org': 'org456'},
    body: {repo: 'iterate/iterate', status: ['finished']},
  })
})

test('artifact sizeBytes tolerates connect int64-as-string serialization', async () => {
  await using fake = await startFakeDepotApi({
    '/depot.ci.v1.CIService/ListArtifacts': {
      artifacts: [
        {
          artifactId: '019f422f-e463-7f1f-bc1d-e5b8bfb14c1d',
          runId: '07qwbk1s76',
          name: 'preview-os-test-artifacts',
          sizeBytes: '342065',
          createdAt: '2026-07-08T14:44:22Z',
        },
      ],
    },
  })

  const client = createDepotClient({apiToken: 't', orgId: 'o', baseUrl: fake.url})
  const result = await client.listArtifacts({runId: '07qwbk1s76'})

  expect(result.artifacts).toMatchObject([{name: 'preview-os-test-artifacts', sizeBytes: 342_065}])
})

test('client surfaces connect error bodies', async () => {
  await using fake = await startFakeDepotApi({}, {status: 401, body: {code: 'unauthenticated', message: 'bad token'}})

  const client = createDepotClient({apiToken: 'wrong', orgId: 'o', baseUrl: fake.url})

  await expect(client.listRuns({repo: 'a/b', status: ['finished']})).rejects.toThrow(
    /depot ListRuns failed: 401 .*bad token/,
  )
})

test('aliases for a branch push run', () => {
  const aliases = depotRunAliases({
    runId: 'n56l2xfdb8',
    repo: 'iterate/iterate',
    status: 'finished',
    createdAt: '2026-07-08T14:45:33Z',
    headSha: '35db0be3d154cc2800129293289a56fe9455c400',
    ref: 'refs/heads/renovate/some/branch',
  })

  expect(aliases).toEqual([
    {type: 'run', value: 'n56l2xfdb8'},
    {type: 'sha', value: '35db0be'},
    {type: 'branch', value: 'renovate__some__branch'},
  ])
})

test('aliases for a PR merge-ref run skip branch and use the head sha', () => {
  const aliases = depotRunAliases({
    runId: 'kq2b8fnqkq',
    repo: 'iterate/iterate',
    status: 'finished',
    createdAt: '2026-07-08T14:45:19Z',
    sha: '3c22e5906c364fd5c79ec859ff7e5b7e3c5a4460',
    headSha: '9e4a363f9d7170d6428ea6c00a5795ff4ac657c0',
    ref: 'refs/pull/1758/merge',
  })

  expect(aliases).toEqual([
    {type: 'run', value: 'kq2b8fnqkq'},
    {type: 'sha', value: '9e4a363'},
  ])
})

async function startFakeDepotApi(responses: Record<string, unknown>, errorResponse?: {status: number; body: unknown}) {
  const {createServer} = await import('node:http')
  const requests: Array<{path: string; headers: Record<string, any>; body: any}> = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      requests.push({path: req.url!, headers: req.headers, body: JSON.parse(raw)})
      const response = errorResponse || {status: responses[req.url!] ? 200 : 404, body: responses[req.url!] || {}}
      res.writeHead(response.status, {'content-type': 'application/json'})
      res.end(JSON.stringify(response.body))
    })
  })
  await new Promise<void>(resolve => server.listen(0, resolve))
  const address = server.address() as {port: number}
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async [Symbol.asyncDispose]() {
      await new Promise(resolve => server.close(resolve))
    },
  }
}
