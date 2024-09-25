import {readFileSync, writeFileSync} from 'fs'
import * as yaml from 'yaml'

type BulkRequest = import('../app/artifact/upload/signed-url/types').BulkRequest
type BulkResponse = import('../app/artifact/upload/signed-url/types').BulkResponse

type UploadParams = {
  inputs: {
    origin: string
    path: string
    name: string
    'github-token': string
  }
  context: ScriptContext
  dependencies: {
    fs: typeof import('fs')
    fsPromises: typeof import('fs/promises')
    mimeTypes: typeof import('mime-types')
    vercelBlobClient: typeof import('@vercel/blob/client')
    glob: {
      create: (
        pattern: string,
      ) => Promise<{globGenerator: () => AsyncGenerator<string, void, unknown>; glob: () => Promise<string[]>}>
    }
  }
}

async function upload(
  {context, inputs, dependencies}: UploadParams,
  // context: {github: {ref_name: string; sha: string; run_id: string}},
  // commit: {ref: string; sha: string; actions_run_id: string},
) {
  const {glob, mimeTypes, fsPromises: fs, fs: fsSync, vercelBlobClient} = dependencies

  const githubToken = inputs['github-token']
  const pathPrefix = '${{ github.repository }}/${{ github.run_id }}/' + inputs.name

  const refName = context.ref.replace('refs/heads/', '')
  if (pathPrefix.startsWith('mmkal/artifact.ci') && refName !== 'main') {
    const oldOrigin = inputs.origin
    inputs.origin = `https://artifactci-git-${refName.replaceAll('/', '-')}-mmkals-projects.vercel.app`
    console.log(`uploading to ${inputs.origin} instead of ${oldOrigin} because ref is ${refName}`)
  }

  Object.assign(global, {
    window: {location: new URL(inputs.origin)}, // create a global `window` object to trick @vercel/blob/client into working. for some reason it refuses to run outside of the browser but it's just a `fetch` wrapper
  })

  const stat = await fs.stat(inputs.path).catch(e => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  const globPattern = stat?.isDirectory() ? `${inputs.path}/**/*` : inputs.path

  const globber = await glob.create(globPattern)
  const files = await globber.glob()

  const filesWithPathnames = files.flatMap(f => {
    if (!fsSync.statSync(f).isFile()) return []
    const pathname = pathPrefix + f.replace(process.cwd(), '')
    return {
      localPath: f,
      viewUrl: `${inputs.origin}/artifact/blob/${pathname}`,
      pathname: pathname,
      contentType: mimeTypes.lookup(f) || 'text/plain',
      multipart: false,
    }
  })
  const pathnameToFile = new Map(filesWithPathnames.map(f => [f.pathname, f]))

  const redactedContext: BulkRequest['clientPayload']['context'] = {
    ...context,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    repository: process.env.GITHUB_REPOSITORY!,
    githubOrigin: process.env.GITHUB_SERVER_URL!,
    ...({payload: null, payloadKeys: Object.keys(context.payload)} as {}),
  }
  const bulkRequest = {
    type: 'bulk',
    callbackUrl: `${inputs.origin}/artifact/upload/signed-url`,
    clientPayload: {
      githubToken,
      commit: {ref: context.ref, sha: context.sha, actions_run_id: context.runId.toString()},
      context: redactedContext,
    },
    files: filesWithPathnames,
  } satisfies BulkRequest

  if (filesWithPathnames.length === 0) {
    throw new Error('No files to upload')
  }

  console.log(
    `Sending bulk request to ${inputs.origin}/artifact/upload/signed-url (${filesWithPathnames.length} files)`,
    {redactedContext},
  )
  const res = await fetch(`${inputs.origin}/artifact/upload/signed-url`, {
    method: 'POST',
    body: JSON.stringify(bulkRequest),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'artifact.ci/action',
    },
  })
  const response = await res.clone().text()
  try {
    if (!res.ok) throw new Error(`failed to upload: ${res.status} ${response}`)
    const data = (await res.json()) as BulkResponse
    for (const result of data.results) {
      const file = pathnameToFile.get(result.pathname)
      if (!file) throw new Error(`file not found for pathname ${result.pathname}`)
      await vercelBlobClient.put(result.pathname, await fs.readFile(file.localPath), {
        access: 'public',
        token: result.clientToken,
        multipart: file.multipart,
        contentType: file.contentType,
      })
      console.log('Uploaded: ' + file.viewUrl)
    }
    console.log('Upload complete')
    return
  } catch (e) {
    console.log('response::::', res.status, response)
    console.log('error::::', e)
    throw e
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
        fs: require('fs'),
        fsPromises: require('fs/promises'),
        mimeTypes: require('mime-types'),
        vercelBlobClient: require('@vercel/blob/client'),
        glob, // ambient variable available from actions/github-script
      }
    `,
    `process.chdir(cwd)`,
    '',
    `${upload.toString()}`,
    ``,
    `await upload({context, inputs, dependencies})`,
  ].join('\n')
  writeFileSync(actionPath, yaml.stringify(parsed, {lineWidth: 0}))
}
