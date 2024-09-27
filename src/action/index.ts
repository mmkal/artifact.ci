import {DefaultArtifactClient} from '@actions/artifact'
import {getBooleanInput, getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {readFile} from 'fs/promises'
import {z} from 'zod'
import {ArtifactciInputs, ScriptContext} from './generate'
import {BulkRequest} from '~/types'

async function main() {
  setOutput('artifacts_uploaded', false)

  if (isDebug()) {
    console.log('getInput(artifactci-origin)', getInput('artifactci-origin'))
  }
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, {encoding: 'utf8'})) as ScriptContext
  function isDebug() {
    if (Math.random()) return true // todo delete
    if (isDebugCore()) return true
    const artifactCiDebugKeyword = event.repository === 'mmkal/artifact.ci' ? 'debug' : 'artifactci_debug'
    return '${{ github.event.head_commit.message }}'.includes(`${artifactCiDebugKeyword}=${context.job}`)
  }

  const Inputs = z.object({
    path: z.string(),
    name: z.string(),
    ifNoFilesFound: z.enum(['warn', 'error', 'ignore']).optional(),
    retentionDays: z.number().optional(),
    compressionLevel: z.number().optional(),
    overwrite: z.boolean().optional(),
    includeHiddenFiles: z.boolean().optional(),
    artifactciOrigin: z.string(),
  })
  const inputs = Inputs.parse(
    Object.fromEntries(
      Object.entries(Inputs.shape).map(([camelCaseKey, value]) => {
        const key = camelCaseKey.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
        console.log({camelCaseKey, key, input: getInput(key, {trimWhitespace: true})})
        if (value instanceof z.ZodBoolean) return [key, getBooleanInput(key, {trimWhitespace: true})]
        if (value instanceof z.ZodNumber) return [key, Number(getInput(key))]
        return [key, getInput(key)]
      }),
    ),
  )
  // const inputs = {
  //   path: getInput('path'),
  //   name: getInput('name'),
  //   ifNoFilesFound: getInput('if-no-files-found') as 'warn' | 'error' | 'ignore' | undefined,
  //   retentionDays: getInput('retention-days') ? Number(getInput('retention-days')) : undefined,
  //   compressionLevel: getInput('compression-level') ? Number(getInput('compression-level')) : undefined,
  //   overwrite: getInput('overwrite') === 'true',
  //   includeHiddenFiles: getInput('include-hidden-files') === 'true',
  //   artifactciOrigin: getInput('artifactci_origin'),
  //   artifactciGithubToken: getInput('artifactci_github_token') || undefined,
  //   artifactciDebug: getInput('artifactci_debug') === 'true' ? true : getInput('artifactci_debug') || undefined,
  // }

  const context = event

  if (isDebug()) {
    console.log(event)
  }

  const client = new DefaultArtifactClient()

  const globber = await glob.create(inputs.path, {
    matchDirectories: false,
    excludeHiddenFiles: !inputs.includeHiddenFiles,
  })
  const files = await globber.glob()
  const uploadResult = await client.uploadArtifact(inputs.name, files, '.', {
    retentionDays: inputs.retentionDays,
    compressionLevel: inputs.compressionLevel,
  })
  if (isDebug()) {
    console.log(uploadResult)
  }
  const bulkRequest = {
    type: 'bulk',
    callbackUrl: `${inputs.artifactciOrigin}/artifact/upload/signed-url`,
    clientPayload: {
      githubToken: null,
      context: {
        ...context,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        repository: process.env.GITHUB_REPOSITORY!,
        githubOrigin: process.env.GITHUB_SERVER_URL!,
        githubRetentionDays: Number(inputs.retentionDays || process.env.GITHUB_RETENTION_DAYS),
        ...({payload: null, payloadKeys: Object.keys(context.payload)} as {}),
      },
    },
    files: JSON.stringify(uploadResult || null) as never,
  } satisfies BulkRequest

  const url = `${inputs.artifactciOrigin}/github/events?mode=test`
  const http = new HttpClient('artifact.ci/action/v0')
  const resp = await http.post(url, JSON.stringify(bulkRequest))
  const body = await resp.readBody()
  if (resp.message.statusCode === 200) {
    console.log('✅ Upload done.')
    setOutput('artifacts_uploaded', true)
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
