import {readFileSync, writeFileSync} from 'fs'
import * as yaml from 'yaml'

type BulkRequest = import('../types').BulkRequest
type BulkResponse = import('../types').BulkResponse

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
  // const pathPrefix = '${{ github.repository }}/${{ github.run_id }}/' + inputs.name

  // const refName = context.ref.replace('refs/heads/', '')
  // if (pathPrefix.startsWith('mmkal/artifact.ci') && refName !== 'main') {
  //   const oldOrigin = inputs.origin
  //   inputs.origin = `https://artifactci-git-${refName.replaceAll('/', '-')}-mmkals-projects.vercel.app`
  //   console.log(`uploading to ${inputs.origin} instead of ${oldOrigin} because ref is ${refName}`)
  // }

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
    // const pathname = pathPrefix + f.replace(process.cwd(), '')
    return {
      localPath: f.replace(process.cwd() + '/', ''),
      multipart: false, // consider letting users set this and content-type?
    }
  })
  const pathnameToFile = new Map(filesWithPathnames.map(f => [f.localPath, f]))

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
    // {redactedContext},
  )
  const chunk = <T>(list: T[], size: number) => {
    const chunks: T[][] = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  }

  const chunked = chunk(bulkRequest.files, 500).map((chunkOfFiles): BulkRequest => {
    return {...bulkRequest, files: chunkOfFiles}
  })
  // eslint-disable-next-line @typescript-eslint/no-shadow
  for (const [i, bulkRequest] of chunked.entries()) {
    console.log(`Uploading chunk ${i + 1} of ${chunked.length}`)
    const res = await fetch(`${inputs.origin}/artifact/upload/signed-url`, {
      method: 'POST',
      body: JSON.stringify(bulkRequest),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'artifact.ci/action',
      },
    })
    console.log('response::::', res.status, Object.fromEntries(res.headers))
    const responseText = await res.clone().text().catch(String)
    console.log('responseText::::', responseText.slice(0, 100))
    try {
      if (!res.ok) throw new Error(`failed to upload: ${res.status} ${responseText}`)
      const data = (await res.json()) as BulkResponse
      if (!data?.results?.length) throw new Error('no results: ' + responseText)
      for (const result of data.results) {
        console.log('Uploading: ' + result.localPath)
        const file = pathnameToFile.get(result.localPath)
        if (file?.localPath !== result.localPath)
          throw new Error(`local path mismatch: ${file?.localPath} !== ${result.localPath}`)

        await vercelBlobClient.put(result.pathname, await fs.readFile(file.localPath), {
          access: 'public',
          token: result.clientToken,
          multipart: file.multipart,
          // contentType not set since there's no way to override it so we'd just be inferring anyway
        })
        console.log('Uploaded: ' + result.viewUrl)
      }
      console.log(`Upload complete (${i + 1} of ${chunked.length})`)
    } catch (e) {
      console.log('response::::', res.status, responseText)
      console.log('error::::', e)
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

const x = {
  results: [
    {
      localPath: 'output.html',
      viewUrl: 'https://www.artifact.ci/artifact/blob2/mmkal/artifact.ci/11041114299/1/ava/output.html',
      pathname: 'mmkal/artifact.ci/11041114299/1/ava/output.html',
      clientToken:
        'vercel_blob_client_8Kc5vtDgp65U3fAR_MWUyNWI0NTU4OWY0NzJjMzFlZDJlNDY1ODE5NjUwYzQzNjkyN2E4NzhhODlkMTc2NTljMmJkMTc2MTY0N2ExOC5leUpoYkd4dmQyVmtRMjl1ZEdWdWRGUjVjR1Z6SWpwYkluUmxlSFF2YUhSdGJDSmRMQ0poWkdSU1lXNWtiMjFUZFdabWFYZ2lPblJ5ZFdVc0luUnZhMlZ1VUdGNWJHOWhaQ0k2SW50Y0luVndiRzloWkZKbGNYVmxjM1JKWkZ3aU9sd2lkWEJzYjJGa1gzSmxjWFZsYzNSZk1tMWFlVmQ1TURRd01qWkxlakpaVUVRMWEwTk1abkJuVGtoSFhDSXNYQ0p5WldaY0lqcGNJbkpsWm5NdmFHVmhaSE12YldGcGJsd2lMRndpYzJoaFhDSTZYQ0l4TURsaE1qazVNR1F4WVRWbU9EYzVZV1JoTVRBek5qWmtOekkyWVdOak56bGlaakE0T0dOaFhDSXNYQ0poWTNScGIyNXpYM0oxYmw5cFpGd2lPbHdpTVRFd05ERXhNVFF5T1RsY0luMGlMQ0p3WVhSb2JtRnRaU0k2SW0xdGEyRnNMMkZ5ZEdsbVlXTjBMbU5wTHpFeE1EUXhNVEUwTWprNUx6RXZZWFpoTDI5MWRIQjFkQzVvZEcxc0lpd2liMjVWY0d4dllXUkRiMjF3YkdWMFpXUWlPbnNpWTJGc2JHSmhZMnRWY213aU9pSm9kSFJ3Y3pvdkwzZDNkeTVoY25ScFptRmpkQzVqYVM5aGNuUnBabUZqZEM5MWNHeHZZV1F2YzJsbmJtVmtMWFZ5YkNJc0luUnZhMlZ1VUdGNWJHOWhaQ0k2SW50Y0luVndiRzloWkZKbGNYVmxjM1JKWkZ3aU9sd2lkWEJzYjJGa1gzSmxjWFZsYzNSZk1tMWFlVmQ1TURRd01qWkxlakpaVUVRMWEwTk1abkJuVGtoSFhDSXNYQ0p5WldaY0lqcGNJbkpsWm5NdmFHVmhaSE12YldGcGJsd2lMRndpYzJoaFhDSTZYQ0l4TURsaE1qazVNR1F4WVRWbU9EYzVZV1JoTVRBek5qWmtOekkyWVdOak56bGlaakE0T0dOaFhDSXNYQ0poWTNScGIyNXpYM0oxYmw5cFpGd2lPbHdpTVRFd05ERXhNVFF5T1RsY0luMGlmU3dpZG1Gc2FXUlZiblJwYkNJNk1UY3lOek13TWpBeU9EQXpOWDA9',
    },
  ],
}
