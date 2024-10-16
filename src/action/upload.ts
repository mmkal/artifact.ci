import {DefaultArtifactClient} from '@actions/artifact'
import {getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {createTRPCClient, httpLink} from '@trpc/client'
import {readFile} from 'fs/promises'
import {z} from 'zod'
import {EventType} from './types'
import {clientUpload} from '~/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/client-upload'
import {UploadRequest, UploadResponse} from '~/app/github/upload/types'
import {AppRouter} from '~/server/trpc'
import {logger} from '~/tag-logger'

async function main() {
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

  const StringyBoolean = z.boolean().or(z.enum(['true', 'false']).transform(s => s === 'true'))

  /** camelCase version of the inputs in action.yml. Note that *most* don't have defaults because the defaults are defined in action.yml */
  const Inputs = z.object({
    path: z.string(),
    name: z.string(),
    ifNoFilesFound: z.enum(['warn', 'error', 'ignore']),
    retentionDays: z.coerce.number().int().min(0).max(90).default(Number(process.env.GITHUB_RETENTION_DAYS)),
    compressionLevel: z.coerce.number().int().min(0).max(9),
    overwrite: StringyBoolean,
    includeHiddenFiles: StringyBoolean,
    artifactciOrigin: z
      .string()
      .default(
        env.GITHUB_REPOSITORY === 'mmkal/artifact.ci' && branchName !== 'main'
          ? `https://artifactci-git-${branchName.replaceAll(/\W/g, '-')}-mmkals-projects.vercel.app`
          : 'https://www.artifact.ci',
      ),
    artifactciVisibility: z.enum(['private', 'public']).optional(),
    artifactciAliasTypes: z
      .string()
      .transform(s => s.split(','))
      .pipe(z.array(z.enum(['run', 'sha', 'branch']))),
    artifactciMode: z.enum(['lazy', 'eager']),
  })

  const coercedInput = Object.fromEntries(
    Object.entries(Inputs.shape).map(([camelKey]) => {
      const kebabKey = camelKey.replaceAll(/([A-Z])/g, '-$1').toLowerCase()
      const value = getInput(kebabKey, {trimWhitespace: true}) || undefined
      logger.debug({camelKey, kebabKey, value})
      return [camelKey, value]
    }),
  ) as {}
  logger.debug({coercedInput}, process.env.GITHUB_RETENTION_DAYS)
  const inputs = Inputs.parse(coercedInput)
  logger.debug({inputs})

  if (isDebug()) {
    logger.info(event)
  }

  const client = new DefaultArtifactClient()

  const globber = await glob.create(inputs.path, {
    matchDirectories: false,
    excludeHiddenFiles: !inputs.includeHiddenFiles,
  })
  const files = await globber.glob()
  const uploadResponse = await client.uploadArtifact(inputs.name, files, '.', {
    retentionDays: inputs.retentionDays,
    compressionLevel: inputs.compressionLevel,
  })
  logger.debug({uploadResult: uploadResponse})

  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
  const uploadRequest = UploadRequest.parse({
    owner,
    repo,
    artifact: {
      id: uploadResponse.id!,
      visibility: inputs.artifactciVisibility,
      aliasTypes: inputs.artifactciAliasTypes,
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
    logger.info('✅ Upload done.')
    setOutput('artifact-id', uploadResponse.id)
    const repository = github.context.repo
    const artifactURL = `${github.context.serverUrl}/${repository.owner}/${repository.repo}/actions/runs/${github.context.runId}/artifacts/${uploadResponse.id}`
    setOutput('artifact-url', artifactURL)

    result.urls.forEach(({aliasType, url}) => {
      logger.info(`🔗 ${aliasType}: ${url}`)
      setOutput(`artifactci-${aliasType}-url`, url)
    })

    if (inputs.artifactciMode === 'eager') {
      const records = await clientUpload({
        artifactId: result.artifactId,
        onProgress(stage, message) {
          logger.info(`${stage}: ${message}`)
        },
        trpcClient: createTRPCClient<AppRouter>({
          links: [
            httpLink({
              url: inputs.artifactciOrigin + '/api/trpc',
              headers: {'artifactci-upload-token': result.uploadToken},
            }),
          ],
        }),
      })

      const {entrypoints} = records.entrypoints
      entrypoints.forEach((e, i) => {
        const url = `${result.urls.at(-1)?.url}/${e.path}`
        logger.info(`🔗 ${e.shortened}: ${url}`)
        setOutput(`artifactci-entrypoint-${i}`, url)
      })
    }
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
