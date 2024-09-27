import {DefaultArtifactClient} from '@actions/artifact'
import {getBooleanInput, getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {readFile} from 'fs/promises'
import {z} from 'zod'
import {BulkRequest} from '~/types'

async function main() {
  setOutput('artifacts_uploaded', false)

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, {encoding: 'utf8'})) as ScriptContext

  function isDebug() {
    if (isDebugCore()) return true
    if (event.repository === 'mmkal/artifact.ci' && event.ref !== 'refs/heads/main') return true
    return false
    // const artifactCiDebugKeyword = event.repository === 'mmkal/artifact.ci' ? 'debug' : 'artifactci_debug'
    // return '${{ github.event.head_commit.message }}'.includes(`${artifactCiDebugKeyword}=${context.job}`)
  }
  const logger = {
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    debug: (...args: unknown[]) => (isDebug() ? console.info(...args) : void 0),
  }
  logger.debug('event', JSON.stringify(event, null, 2))
  logger.debug('getInput(artifactci-origin)', getInput('artifactci-origin'))

  const StringyBoolean = z.boolean().or(z.enum(['true', 'false']).transform(s => s === 'true'))
  const Inputs = z.object({
    path: z.string(),
    name: z.string(),
    ifNoFilesFound: z.enum(['warn', 'error', 'ignore']),
    retentionDays: z.coerce.number().int().min(0).max(90).default(Number(process.env.GITHUB_RETENTION_DAYS)),
    compressionLevel: z.coerce.number().int().min(0).max(9),
    overwrite: StringyBoolean,
    includeHiddenFiles: StringyBoolean,
    artifactciOrigin: z.string(),
    artifactciGithubToken: z.string().optional(),
  })
  const coercedInput = Object.fromEntries(
    Object.entries(Inputs.shape).map(([camelKey, value]) => {
      const kebabKey = camelKey.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
      logger.debug({camelCaseKey: camelKey, kebabKey, input: getInput(kebabKey, {trimWhitespace: true})})
      if (value instanceof z.ZodBoolean) return [camelKey, getBooleanInput(kebabKey, {trimWhitespace: true})]
      if (value instanceof z.ZodNumber) return [camelKey, Number(getInput(kebabKey))]
      return [camelKey, getInput(kebabKey)]
    }),
  ) as {}
  logger.debug({coercedInput})
  const inputs = Inputs.parse(coercedInput)
  logger.debug({inputs})
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
        ...event,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        repository: process.env.GITHUB_REPOSITORY!,
        githubOrigin: process.env.GITHUB_SERVER_URL!,
        githubRetentionDays: inputs.retentionDays,
        ...({payload: null, payloadKeys: Object.keys(event.payload)} as {}),
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

export type ScriptContext = typeof _exampleScriptContext
const _exampleScriptContext = {
  payload: {} as Record<string, unknown>,
  eventName: 'push',
  sha: 'f7767c385252ae7d911923a4a8b29aac4be7cec6',
  ref: 'refs/heads/main',
  workflow: 'Recipes',
  action: '__self',
  actor: 'mmkal',
  job: 'mocha',
  runNumber: 31,
  runId: 10_963_802_899,
  repository: 'mmkal/artifact.ci',
  apiUrl: 'https://api.github.com',
  serverUrl: 'https://github.com',
  graphqlUrl: 'https://api.github.com/graphql',
}
