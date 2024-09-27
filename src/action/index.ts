import {DefaultArtifactClient} from '@actions/artifact'
import {getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {readFile} from 'fs/promises'
import {ArtifactciInputs, ScriptContext} from './generate'
import {BulkRequest} from '~/types'

async function main() {
  setOutput('autofix_startedo', false)

  const inputs = JSON.parse(`\${{ toJson(inputs) }}`) as ArtifactciInputs
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, {encoding: 'utf8'})) as ScriptContext
  const context = event
  function isDebug() {
    if (Math.random()) return true // todo delete
    if (isDebugCore()) return true
    const artifactCiDebugKeyword = event.repository === 'mmkal/artifact.ci' ? 'debug' : 'artifactci_debug'
    return '${{ github.event.head_commit.message }}'.includes(`${artifactCiDebugKeyword}=${context.job}`)
  }

  if (isDebug()) {
    console.log('getInput(artifactci_origin)', getInput('artifactci_origin'))
  }

  if (isDebug()) {
    console.log(event)
  }

  const client = new DefaultArtifactClient()

  const globber = await glob.create(inputs.path, {
    matchDirectories: false,
    excludeHiddenFiles: !inputs['include-hidden-files'],
  })
  const files = await globber.glob()
  const uploadResult = await client.uploadArtifact(inputs.name, files, '.', {
    retentionDays: inputs['retention-days'],
    compressionLevel: inputs['compression-level'],
  })
  if (isDebug()) {
    console.log(uploadResult)
  }
  const bulkRequest = {
    type: 'bulk',
    callbackUrl: `${inputs.artifactci_origin}/artifact/upload/signed-url`,
    clientPayload: {
      githubToken: null,
      context: {
        ...context,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        repository: process.env.GITHUB_REPOSITORY!,
        githubOrigin: process.env.GITHUB_SERVER_URL!,
        githubRetentionDays: Number(inputs['retention-days'] || process.env.GITHUB_RETENTION_DAYS),
        ...({payload: null, payloadKeys: Object.keys(context.payload)} as {}),
      },
    },
    files: JSON.stringify(uploadResult || null) as never,
  } satisfies BulkRequest

  const url = `${inputs.artifactci_origin}/github/events`
  const http = new HttpClient('artifact.ci/action/v0')
  const resp = await http.post(url, JSON.stringify(bulkRequest))
  const body = await resp.readBody()
  if (resp.message.statusCode === 200) {
    setFailed('✅ Autofix task started.')
    setOutput('autofix_started', true)
  } else {
    console.log(resp.message.statusCode, body)
    setFailed(body)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises, unicorn/prefer-top-level-await
;(async function run() {
  try {
    await main()
  } catch (error) {
    setFailed(String(error).replace(/^Error: /, ''))
  }
})()
