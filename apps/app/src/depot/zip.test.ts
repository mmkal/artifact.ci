import {expect, test} from 'vitest'
import {getDb} from '../cloudflare-env'
import {createUploadToken} from '../upload-tokens'
import {syncAllDepotConnections} from './sync'
import {handleDepotArtifactZipRequest} from './zip'

test('zip proxy streams a depot artifact for an authorized token', async () => {
  await using world = await setupSyncedWorld()
  const zipBytes = Buffer.from('PK pretend this is a zip')
  world.storage.zips[`/${world.depotArtifactId}`] = zipBytes

  const token = await world.run(() => createUploadToken(getDb(), 'iterate'))
  const response = await world.run(() =>
    handleDepotArtifactZipRequest(
      new Request(`https://artifact.ci/api/depot/artifact-zip/${world.artifactRowId}`, {
        headers: {'artifactci-upload-token': token},
      }),
    ),
  )

  expect(response.status).toBe(200)
  expect(Object.fromEntries(response.headers)).toMatchObject({
    'content-type': 'application/zip',
    'content-disposition': 'attachment; filename="preview-os-test-artifacts.zip"',
  })
  expect(Buffer.from(await response.arrayBuffer()).equals(zipBytes)).toBe(true)
})

test('zip proxy rejects unauthenticated requests', async () => {
  await using world = await setupSyncedWorld()

  const response = await world.run(() =>
    handleDepotArtifactZipRequest(new Request(`https://artifact.ci/api/depot/artifact-zip/${world.artifactRowId}`)),
  )

  expect(response.status).toBe(401)
})

test('zip proxy refuses non-depot artifacts', async () => {
  await using world = await setupSyncedWorld()
  world.exec(`
    insert into artifacts (id, repo_id, name, github_id, installation_id)
    select 'artifact_github_one', repo_id, 'gh-artifact', 123, installation_id from artifacts limit 1
  `)

  const token = await world.run(() => createUploadToken(getDb(), 'iterate'))
  const response = await world.run(() =>
    handleDepotArtifactZipRequest(
      new Request('https://artifact.ci/api/depot/artifact-zip/artifact_github_one', {
        headers: {'artifactci-upload-token': token},
      }),
    ),
  )

  expect(response.status).toBe(400)
})

/** a world where one depot run with one artifact has already been synced */
async function setupSyncedWorld() {
  const {setupDepotSyncWorld} = await import('./test-world')
  const world = await setupDepotSyncWorld()
  const depotArtifactId = '019f4231-2a2b-7db7-ac8b-7cd9d1bf1f0e'
  world.depot.runs = [
    {
      runId: 'kq2b8fnqkq',
      repo: 'iterate/iterate',
      status: 'finished',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      headSha: '9e4a363f9d7170d6428ea6c00a5795ff4ac657c0',
      ref: 'refs/pull/1758/merge',
    },
  ]
  world.depot.artifacts.kq2b8fnqkq = [
    {
      artifactId: depotArtifactId,
      runId: 'kq2b8fnqkq',
      name: 'preview-os-test-artifacts',
      createdAt: new Date().toISOString(),
    },
  ]
  await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))

  // seed a usage credit so access checks don't reach for posthog free-trial reporting
  world.exec(`
    insert into usage_credits (id, github_login, reason, expiry)
    values ('usage_credit_test', 'iterate', 'test', '2999-01-01T00:00:00Z')
  `)

  const artifactRowId = world.query(`select id from artifacts`)[0].id as string
  return Object.assign(world, {artifactRowId, depotArtifactId})
}
