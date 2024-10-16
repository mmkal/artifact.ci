import {DefaultArtifactClient} from '@actions/artifact'
import {getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import {HttpClient} from '@actions/http-client'
import {createTRPCClient, httpLink} from '@trpc/client'
import {makeBadge} from 'badge-maker'
import * as fs from 'fs/promises'
import {readFile} from 'fs/promises'
import * as path from 'path'
import {z} from 'zod'
import {EventType} from './types'
import {clientUpload} from '~/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/client-upload'
import {UploadRequest, UploadResponse} from '~/app/github/upload/types'
import {AppRouter} from '~/server/trpc'
import {logger} from '~/tag-logger'

async function main() {
  setOutput('artifacts_uploaded', false)

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, {encoding: 'utf8'})) as EventType

  function isDebug() {
    if (isDebugCore()) return true
    if (event.repository.full_name === 'mmkal/artifact.ci' && event.ref !== 'refs/heads/main') return true
    return false
  }
  if (isDebug()) {
    logger.level = 'debug'
  }

  logger.debug('event', JSON.stringify(event, null, 2))

  const Env = z.object({
    GITHUB_REPOSITORY: z.string(),
    GITHUB_RUN_ID: z.string().transform(Number).pipe(z.number().int()),
    GITHUB_RUN_ATTEMPT: z.string().transform(Number).pipe(z.number().int()),
    GITHUB_JOB: z.string(),
    GITHUB_SHA: z.string().regex(/^[\da-f]{40}$/),
    GITHUB_REF_NAME: z.string(), // for PRs, this is `1234/merge`
    GITHUB_HEAD_REF: z.string().optional(), // for PRs, this is the head branch
  })
  const env = Env.parse(process.env)

  const branchName = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME

  logger.debug({env, branchName})

  let defaultBackend = 'https://www.artifact.ci'
  if (env.GITHUB_REPOSITORY === 'mmkal/artifact.ci' && branchName !== 'main') {
    // use vercel preview url - this isn't an exact match for their slugify algorithm but for simple branch names it works: https://github.com/orgs/vercel/discussions/472
    defaultBackend = `https://artifactci-git-${branchName.replaceAll(/\W/g, '-')}-mmkals-projects.vercel.app`
  }
  /** camelCase version of the inputs in action.yml. Note that *most* don't have defaults because the defaults are defined in action.yml */
  const Inputs = z.object({
    name: z
      .string()
      .regex(/^[\w-]+$/)
      .max(50)
      .optional(),
    artifactciOrigin: z.string().default(defaultBackend),
    message: z.string().max(100),
    label: z.string().max(100).optional(),
    /** see https://www.npmjs.com/package/badge-maker#colors */
    labelColor: z.string().optional(),
    /** see https://www.npmjs.com/package/badge-maker#colors */
    color: z.string().optional(),
    logoBase64: z.string().optional(),
    // links: z.array(z.string()).max(2),
    style: z.enum(['plastic', 'flat', 'flat-square', 'for-the-badge', 'social']).optional(),
    idSuffix: z
      .string()
      .regex(/^[\w-]+$/)
      .optional(),
  })

  const coercedInput = Object.fromEntries(
    Object.entries(Inputs.shape).map(([camelKey]) => {
      const kebabKey = camelKey.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
      const value = getInput(kebabKey, {trimWhitespace: true}) || undefined
      logger.debug({camelKey, kebabKey, value})
      return [camelKey, value]
    }),
  ) as {}

  logger.debug({coercedInput})
  const inputs = Inputs.parse(coercedInput)
  logger.debug({inputs})

  const artifactClient = new DefaultArtifactClient()

  const file = path.join(process.cwd(), 'badge.svg')
  await fs.writeFile(
    file,
    makeBadge(
      Object.fromEntries(
        Object.entries(inputs).filter(([k, v]) => !k.startsWith('artifactci') && k !== 'name' && v !== undefined),
      ) as typeof inputs,
    ),
  )

  const artifactName = (inputs.name || inputs.label || inputs.message).replaceAll(/\W/g, '')
  const uploadResponse = await artifactClient.uploadArtifact(artifactName, [file], '.', {retentionDays: 1})
  logger.debug({uploadResponse})
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
  const uploadRequest = UploadRequest.parse({
    owner,
    repo,
    artifact: {
      id: uploadResponse.id!,
      visibility: 'public',
      aliasTypes: ['sha', 'branch'],
    },
    job: {
      head_branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      head_sha: env.GITHUB_SHA,
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
  } satisfies UploadRequest)

  const uploadUrl = `${inputs.artifactciOrigin}/github/upload`
  logger.debug({uploadUrl, uploadRequest})

  const http = new HttpClient('artifact.ci/action/v0')
  const resp = await http.post(uploadUrl, JSON.stringify(uploadRequest), {
    'content-type': 'application/json',
    'artifactci-debug': isDebug() ? 'true' : 'false',
  })

  const body = await resp.readBody()
  logger.debug({statusCode: resp.message.statusCode, body: body.slice(0, 500)})
  if (resp.message.statusCode === 200) {
    const result = UploadResponse.parse(JSON.parse(body))
    if (result.urls.length !== 1) throw new Error(`expected 1 url, got ${result.urls.length}`)
    logger.debug('✅ Upload done', result)
    const records = await clientUpload({
      artifactId: result.artifactId,
      onProgress: (stage, message) => logger.debug(`${stage}: ${message}`),
      trpcClient: createTRPCClient<AppRouter>({
        links: [
          httpLink({
            url: inputs.artifactciOrigin + '/api/trpc',
            headers: {'artifactci-upload-token': result.uploadToken},
          }),
        ],
      }),
    })
    logger.debug('clientUpload done', records)

    const {entrypoints} = records.entrypoints
    if (entrypoints.length !== 1) throw new Error(`expected 1 entrypoint, got ${entrypoints.length}`)
    const {url: baseUrl} = result.urls[0]
    const e = entrypoints[0]
    const badgeUrl = `${baseUrl}/${e.path}`
    logger.info('badge_url', badgeUrl)
    setOutput('badge_url', badgeUrl)
  } else {
    logger.error(resp.message.statusCode, body)
    setFailed(body)
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises, unicorn/prefer-top-level-await
;(async function run() {
  try {
    await logger.try('action', main)
  } catch (error) {
    setFailed(String((error as Error)?.stack || error))
  }
})()
