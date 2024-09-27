import {readFileSync, writeFileSync} from 'fs'
import * as yaml from 'yaml'

// better approach: https://github.com/autofix-ci/action/blob/main/index.ts

type BulkRequest = import('../types').BulkRequest
type BulkResponse = import('../types').BulkResponse

export type ArtifactciInputs = {
  path: string
  name: string
  'if-no-files-found'?: 'warn' | 'error' | 'ignore'
  'retention-days'?: number
  'compression-level'?: number
  overwrite?: boolean
  'include-hidden-files'?: boolean
  artifactci_origin: string
  artifactci_github_token?: string
  artifactci_debug?: string | boolean
}

type UploadParams = {
  inputs: ArtifactciInputs
  context: ScriptContext
  dependencies: {
    fsPromises: typeof import('fs/promises')
    vercelBlobClient: typeof import('@vercel/blob/client')
    glob: {
      create: (
        pattern: string,
        options?: {matchDirectories?: boolean},
      ) => Promise<{globGenerator: () => AsyncGenerator<string, void, unknown>; glob: () => Promise<string[]>}>
    }
  }
}

async function upload({context, inputs, dependencies}: UploadParams) {
  const artifactCiDebugKeyword = context.repository === 'mmkal/artifact.ci' ? 'debug' : 'artifactci_debug'
  inputs.artifactci_debug ??= '${{ github.event.head_commit.message }}'.includes(
    `${artifactCiDebugKeyword}=${context.job}`,
  )
  if (inputs.artifactci_debug === 'false') {
    inputs.artifactci_debug = false
  }

  const logger = {
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    debug: (...args: unknown[]) => {
      if (inputs.artifactci_debug && inputs.artifactci_debug !== 'false') console.info(...args)
    },
  }

  logger.info('context:::::', context)
  logger.info('toJson(github)', `\${{ toJson(github) }}`)

  const {glob, fsPromises: fs, vercelBlobClient} = dependencies

  const githubToken = inputs.artifactci_github_token || null

  // const pathPrefix = '${{ github.repository }}/${{ github.run_id }}/' + inputs.name

  // const refName = context.ref.replace('refs/heads/', '')
  // if (pathPrefix.startsWith('mmkal/artifact.ci') && refName !== 'main') {
  //   const oldOrigin = inputs.origin
  //   inputs.origin = `https://artifactci-git-${refName.replaceAll('/', '-')}-mmkals-projects.vercel.app`
  //   console.log(`uploading to ${inputs.origin} instead of ${oldOrigin} because ref is ${refName}`)
  // }

  Object.assign(global, {
    window: {location: new URL(inputs.artifactci_origin)}, // create a global `window` object to trick @vercel/blob/client into working. for some reason it refuses to run outside of the browser but it's just a `fetch` wrapper
  })

  const stat = await fs.stat(inputs.path).catch(e => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  const globPattern = stat?.isDirectory() ? `${inputs.path}/**/*` : inputs.path

  const globber = await glob.create(globPattern, {matchDirectories: false})
  const files = await globber.glob()

  const filesWithPathnames = files.map(f => {
    return {
      localPath: f.replace(process.cwd() + '/', ''),
      multipart: false, // consider letting users set this and content-type?
    }
  })
  const pathnameToFile = new Map(filesWithPathnames.map(f => [f.localPath, f]))

  const bulkRequest = {
    type: 'bulk',
    callbackUrl: `${inputs.artifactci_origin}/artifact/upload/signed-url`,
    clientPayload: {
      githubToken,
      context: {
        ...context,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        repository: process.env.GITHUB_REPOSITORY!,
        githubOrigin: process.env.GITHUB_SERVER_URL!,
        githubRetentionDays: Number(inputs['retention-days'] || process.env.GITHUB_RETENTION_DAYS),
        ...({payload: null, payloadKeys: Object.keys(context.payload)} as {}),
      },
    },
    files: filesWithPathnames,
  } satisfies BulkRequest

  if (filesWithPathnames.length === 0 && inputs['if-no-files-found'] === 'error') {
    throw new Error('No files to upload')
  } else if (filesWithPathnames.length === 0 && inputs['if-no-files-found'] === 'warn') {
    logger.warn('No files to upload')
  }

  logger.info(`Requesting tokens for ${filesWithPathnames.length} files`)
  logger.debug(filesWithPathnames)

  const chunk = <T>(list: T[], size: number) => {
    const chunks: T[][] = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  }

  const MAX_FILES = 500
  const CHUNK_SIZE = MAX_FILES // set to max files to prevent chunking - server rate limiting disallows this for now, but might need to re-evaluate if payloads get too big
  if (bulkRequest.files.length > MAX_FILES) {
    throw new Error(`Too many files: ${bulkRequest.files.length}`)
  }

  const chunked = chunk(bulkRequest.files, CHUNK_SIZE).map((chunkOfFiles): BulkRequest => {
    return {...bulkRequest, files: chunkOfFiles}
  })
  // eslint-disable-next-line @typescript-eslint/no-shadow
  for (const [i, bulkRequest] of chunked.entries()) {
    logger.debug(`Uploading chunk ${i + 1} of ${chunked.length}`)
    const res = await fetch(`${inputs.artifactci_origin}/artifact/upload/signed-url`, {
      method: 'POST',
      body: JSON.stringify(bulkRequest),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'artifact.ci/action',
      },
    })
    logger.debug('response::::', res.status, Object.fromEntries(res.headers))
    logger.debug({res})
    const responseText = () => res.clone().text().catch(String)
    try {
      if (!res.ok) throw new Error(`failed to upload: ${res.status} ${await responseText()}`)

      const data = (await res.json()) as BulkResponse
      if (!data?.results?.length) throw new Error('no results: ' + (await responseText()))

      const entrypoints = new Set(data.entrypoints)
      for (const result of data.results) {
        logger.debug('Uploading: ' + result.localPath)
        const file = pathnameToFile.get(result.localPath)
        if (file?.localPath !== result.localPath) {
          throw new Error(`local path mismatch: ${file?.localPath} !== ${result.localPath}`)
        }

        await vercelBlobClient.put(result.pathname, await fs.readFile(file.localPath), {
          access: 'public',
          token: result.clientToken,
          multipart: file.multipart,
          contentType: result.contentType,
        })

        const log = entrypoints.has(result.pathname) || entrypoints.size === 0 ? logger.info : logger.debug
        log(`Uploaded: ${result.viewUrl}`)
      }

      logger.info(`Upload complete (${i + 1} of ${chunked.length})`)
    } catch (e) {
      logger.error('response::::', res.status, responseText)
      logger.error('error::::', e)
      throw e
    }
  }
}

/* eslint-disable unicorn/numeric-separators-style */
export type ScriptContext = typeof _exampleScriptContext
const _exampleScriptContext = {
  payload: {} as Record<string, unknown>,
  eventName: 'push',
  sha: 'f7767c385252ae7d911923a4a8b29aac4be7cec6',
  ref: 'refs/heads/bulk',
  workflow: 'Recipes',
  action: '__self',
  actor: 'mmkal',
  job: 'mocha',
  runNumber: 31,
  runId: 10963802899,
  repository: 'mmkal/artifact.ci',
  apiUrl: 'https://api.github.com',
  serverUrl: 'https://github.com',
  graphqlUrl: 'https://api.github.com/graphql',
}

if (require.main === module) {
  const actionPath = process.cwd() + '/upload/action.yml'
  const yml = readFileSync(actionPath, 'utf8')
  const parsed = yaml.parse(yml) as {runs: {steps: {name: string; with: {script: string}}[]}}
  const scriptStep = parsed.runs.steps.find(s => s.name === 'upload blob')
  if (!scriptStep)
    throw new Error(
      `Expected to find step "upload blob", steps: ${JSON.stringify(
        parsed.runs.steps.map(s => s.name || null),
        null,
        2,
      )}`,
    )
  scriptStep.with.script = [
    // `console.log('context:::::', JSON.stringify(context, null, 2))`,
    `const inputs = \${{ toJson(inputs) }}`,
    '',
    `const cwd = process.cwd()`,
    `process.chdir('tmp/artifact.ci')`, // change into the directory where node_modules is available
    `
      const dependencies = {
        fsPromises: require('fs/promises'),
        vercelBlobClient: require('@vercel/blob/client'),
        glob, // ambient variable available from actions/github-script
      }
    `,
    `process.chdir(cwd)`,
    '',
    `
      const __name = (fn, value) => {
        // for some reason tsx .toString() relies on this
        Object.defineProperty(fn, 'name', {value})
        return fn
      }
    `,
    `${upload.toString()}`,
    ``,
    `await upload({context, inputs, dependencies})`,
  ].join('\n')
  writeFileSync(actionPath, yaml.stringify(parsed, {lineWidth: 0}))
}
