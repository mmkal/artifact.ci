import {DefaultArtifactClient} from '@actions/artifact'
import {getInput, isDebug as isDebugCore, setFailed, setOutput} from '@actions/core'
import * as glob from '@actions/glob'
import {HttpClient} from '@actions/http-client'
import {readFile} from 'fs/promises'
import {z} from 'zod'
import {EventType} from './types'
import {UploadRequest, UploadResponse} from '~/app/github/upload/types'
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

  const StringyBoolean = z.boolean().or(z.enum(['true', 'false']).transform(s => s === 'true'))

  /** camelCase version of the inputs in action.yml */
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
  logger.debug({uploadResult})

  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
  const uploadRequest = UploadRequest.parse({
    owner,
    repo,
    artifact: {id: uploadResult.id!},
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
    console.log('✅ Upload done.')
    setOutput('artifact_uploaded', true)
    result.urls.forEach(({aliasType, url}) => {
      console.log(`🔗 ${aliasType}: ${url}`)
      setOutput(`${aliasType}_url`, url)
    })
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
