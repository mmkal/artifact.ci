import {expect, test} from 'vitest'
import {syncAllDepotConnections} from './sync'
import {setupDepotSyncWorld} from './test-world'

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
