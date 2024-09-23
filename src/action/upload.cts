import * as yaml from 'yaml'
import { readFileSync, writeFileSync } from 'fs'

type BulkRequest = import('../app/artifact/upload/signed-url/route').BulkRequest
type BulkResponse = import('../app/artifact/upload/signed-url/route').BulkResponse

type UploadParams = {
  inputs: {
    origin: string
    path: string
    name: string
    'github-token': string
  }
  context: ScriptContext
  glob: Globber
}

export const actionScript = () => {
  const fnSrc = doupload.toString()//.split(';').join(';\n')
  // eslint-disable-next-line unicorn/template-indent
  return [
    `const cwd = process.cwd()`,
    `process.chdir('tmp/artifact.ci')`,
    `const inputs = \${{ toJson(inputs) }}`,
    `process.chdir(cwd)`,
    `${fnSrc}`,
    `await doupload({context, glob, inputs})`,
  ].join('\n')
}

export async function doupload(
  {context, glob, inputs}: UploadParams,
  // context: {github: {ref_name: string; sha: string; run_id: string}},
  // commit: {ref: string; sha: string; actions_run_id: string},
) {
  const cwd = process.cwd()
  process.chdir('tmp/artifact.ci')

  const {lookup: mimeTypeLookup} = await import('mime-types')
  const fs = await import('fs/promises')
  const {upload, put} = await import('@vercel/blob/client')

  process.chdir(cwd)

  const githubToken = inputs['github-token']
  const pathPrefix = '${{ github.repository }}/${{ github.run_id }}/' + inputs.name

  // console.log({githubToken, inputs, pathPrefix})

  // console.log('lazy url:')
  // console.log(`${inputs.origin}/artifact/browse/${pathPrefix}`)

  Object.assign(global, {
    window: {location: new URL(inputs.origin)}, // create a global `window` object to trick @vercel/blob/client into working. for some reason it refuses to run outside of the browser but it's just a `fetch` wrapper
  })

  const stat = await fs.stat(inputs.path).catch(e => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  const globPattern = stat?.isDirectory() ? `${inputs.path}/**/*` : inputs.path
  // console.log({globPattern})

  if (Math.random()) {
    const globber = await glob.create(globPattern)
    const files = await globber.glob()

    const bulkRequest = {
      type: 'bulk',
      files: files.map(f => {
        const pathname = pathPrefix + f.replace(process.cwd(), '')
        return {pathname}
      }),
      callbackUrl: `${inputs.origin}/artifact/upload/signed-url`,
      clientPayload: {
        githubToken,
        commit: {ref: context.ref, sha: context.sha, actions_run_id: context.runId.toString()},
        context,
      },
    } satisfies BulkRequest

    const res = await fetch(`${inputs.origin}/artifact/upload/signed-url`, {
      method: 'POST',
      body: JSON.stringify(bulkRequest),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'artifact.ci/action',
      },
    })
    const data = (await res.json()) as Promise<BulkResponse>
    console.log('data::::', data)
  }

  const results = {}
  const globber = await glob.create(globPattern)
  for await (const filepath of globber.globGenerator()) {
    const fileStat = await fs.stat(filepath)
    if (fileStat.isDirectory()) continue
    const blobPath = pathPrefix + filepath.replace(process.cwd(), '')
    // console.log(`uploading file ${filepath} to ${blobPath}`)

    const content = await fs.readFile(filepath)
    const result = await upload(blobPath, content, {
      access: 'public', // todo: allow access level override?
      handleUploadUrl: '/artifact/upload/signed-url',
      contentType: mimeTypeLookup(filepath) || 'text/plain', // todo: allow mime type override?
      clientPayload: JSON.stringify({
        githubToken,
        commit: {
          ref: context.ref,
          sha: context.sha,
          actions_run_id: context.runId,
        },
      }),
    })
    // console.log(`uploaded file ${filepath} to ${blobPath}`, result)
    results[blobPath] = result
  }

  if (Object.keys(results).length === 0) {
    throw new Error('no files uploaded')
  }

  console.log(`View your files here:`)

  Object.keys(results).forEach(blobPath => {
    console.log(`${inputs.origin}/artifact/blob/${blobPath}`)
  })
}

export type Globber = {
  create: (pattern: string) => Promise<{
    globGenerator: () => AsyncGenerator<string, void, unknown>
    glob: () => Promise<string[]>
  }>
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
  const parsed = yaml.parse(yml)
  const scriptStep = parsed.runs.steps.find(s => s.name === 'upload blob')
  scriptStep.with.script = actionScript()
  writeFileSync(actionPath, yaml.stringify(parsed, {lineWidth: 0}))
}
