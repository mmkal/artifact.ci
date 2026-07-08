import {expect, test} from 'vitest'
import {getDb} from '../cloudflare-env'
import {createUploadToken} from '../upload-tokens'
import {syncAllDepotConnections} from './sync'
import {setupDepotSyncWorld} from './test-world'
import {handleDepotArtifactZipRequest} from './zip'

/**
 * Live smoke test against the real depot.dev API for the iterate/iterate
 * testbed org. Reads only: run listing, artifact listing, and one zip
 * download. GitHub stays pointed at the in-process fake, so no check runs
 * or anything else touch the real repo.
 *
 * Run with: DEPOT_LIVE_TOKEN=$(yq .api_token ~/Library/Application\ Support/depot/depot.yaml) pnpm vitest run apps/app/src/depot/live.test.ts
 */
test.skipIf(!process.env.DEPOT_LIVE_TOKEN)(
  'live: sync pulls real iterate runs and the proxy streams a real zip',
  {timeout: 120_000},
  async () => {
    await using world = await setupDepotSyncWorld({
      depotApiUrl: 'https://api.depot.dev',
      depotApiToken: process.env.DEPOT_LIVE_TOKEN!,
    })

    const results = await world.run(() => syncAllDepotConnections({origin: 'https://artifact.ci'}))
    expect(results).toMatchObject([{connection: 'iterate/iterate'}])
    expect((results[0] as {error?: string}).error).toBeUndefined()

    const artifacts = world.query(`
      select a.id, a.name, a.depot_artifact_id, ai.type, ai.value
      from artifacts a
      join artifact_identifiers ai on ai.artifact_id = a.id
      where ai.type = 'run'
    `)
    console.log('live artifacts synced:', JSON.stringify(artifacts, null, 2).slice(0, 2000))
    console.log('check runs that would be posted:', JSON.stringify(world.github.checkRuns, null, 2).slice(0, 2000))
    expect(artifacts.length).toBeGreaterThan(0)
    expect(world.github.checkRuns.length).toBeGreaterThan(0)

    world.exec(`
      insert into usage_credits (id, github_login, reason, expiry)
      values ('usage_credit_live', 'iterate', 'live-test', '2999-01-01T00:00:00Z')
    `)
    const token = await world.run(() => createUploadToken(getDb(), 'iterate'))
    const response = await world.run(() =>
      handleDepotArtifactZipRequest(
        new Request(`https://artifact.ci/api/depot/artifact-zip/${artifacts[0].id as string}`, {
          headers: {'artifactci-upload-token': token},
        }),
      ),
    )

    expect(response.status).toBe(200)
    const bytes = Buffer.from(await response.arrayBuffer())
    console.log(`downloaded ${artifacts[0].name as string}: ${bytes.length} bytes`)
    // zip magic bytes prove we streamed a real artifact archive
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
  },
)
