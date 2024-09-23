import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import * as cheerio from 'cheerio'
import {lookup as mimeLookup} from 'mime-types'
import {NextResponse} from 'next/server'
import {z} from 'zod'
import {nullify404} from '~/app/artifact/browse/[...slug]/route'
import {client, Id, sql} from '~/db'

export const maxDuration = 59

const CommitProps = z.object({
  ref: z.string(),
  sha: z.string(),
  actions_run_id: z.string(),
})
export type CommitProps = z.infer<typeof CommitProps>

const GithubActionsContext = z.object({
  ref: z.string(),
  sha: z.string(),
  runId: z.number(),
  runAttempt: z.number(),
  jobName: z.string(),
  repository: z.string().refine(s => s.split('/').length === 2, 'Repository should be in the format of owner/repo'),
  githubOrigin: z.string(), // usually https://github.com
})
export type GithubActionsContext = z.infer<typeof GithubActionsContext>

const ClientPayload = z.object({
  githubToken: z.string(),
  commit: CommitProps,
  context: GithubActionsContext,
})
export type ClientPayload = z.infer<typeof ClientPayload>

const TokenPayload = CommitProps.extend({
  uploadRequestId: Id('upload_requests'),
})

export type GenerateClientTokenEvent = Extract<HandleUploadBody, {type: 'blob.generate-client-token'}>

const BulkRequestFile = z.object({
  pathname: z.string(),
  contentType: z.string(),
  multipart: z.boolean(),
})

const BulkRequest = z.object({
  type: z.literal('bulk'),
  files: z.array(BulkRequestFile),
  callbackUrl: z.string(),
  clientPayload: ClientPayload,
})
export type BulkRequest = z.infer<typeof BulkRequest>

const BulkResponseItem = z.object({
  pathname: z.string(),
  clientToken: z.string(),
})
export type BulkResponseItem = z.infer<typeof BulkResponseItem>

const BulkResponse = z.object({
  results: z.array(BulkResponseItem),
})
export type BulkResponse = z.infer<typeof BulkResponse>

type TokenPayload = z.infer<typeof TokenPayload>

const tokenPayloadCodec = {
  parse: (text: string): TokenPayload => {
    return TokenPayload.parse(JSON.parse(text))
  },
  stringify: (value: TokenPayload): string => {
    return JSON.stringify(value)
  },
}

class ResponseError extends Error {
  constructor(readonly response: NextResponse<object>) {
    super()
  }
}

const allowedContentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'application/xml',
  'application/pdf',
  'application/zip',
  'font/woff2',
  // todo(paid): only allow a subset for free users?
])

const isAllowedContentType = (mimeType: string) => {
  if (allowedContentTypes.has(mimeType)) return true

  console.warn(`New content type - ${mimeType} - add to allowed content types. Allowing anyway for now`)
  return true
}

const getMimeType = (pathname: string) => mimeLookup(pathname) || 'text/plain'

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = (await request.json()) as HandleUploadBody | BulkRequest
  console.log(
    JSON.stringify({url: request.url, body: requestBody, headers: Object.fromEntries(request.headers)}, null, 2),
  )

  if (requestBody.type === 'bulk') {
    const parseResult = BulkRequest.safeParse(requestBody)
    if (!parseResult.success) {
      return NextResponse.json({error: 'Invalid bulk request: ' + parseResult.error.message}, {status: 400})
    }

    const body = parseResult.data

    const {context} = body.clientPayload
    const [owner, repo] = context.repository.split('/')
    const htmlUrl = `${context.githubOrigin}/${owner}/${repo}`

    const jobs = await getJobsWithStatuses(context)

    const matchingJob = jobs.get().find(job => job.jobName === context.jobName && job.isRunning)

    if (!matchingJob) {
      const message = `Job not found or was not running. Found job info: ${JSON.stringify(jobs.get(), null, 2)}`
      return NextResponse.json({message}, {status: 404})
    }

    const insertedUploadRequest = await client.maybeOne(
      sql<queries.UploadRequest>`
        with repo as (
          insert into repos (owner, name, html_url)
          values (${owner}, ${repo}, ${htmlUrl})
          on conflict (html_url) do update set updated_at = current_timestamp
          returning *
        )
        insert into upload_requests (repo_id, ref, sha, actions_run_id, actions_run_attempt, job_name)
        select
          repo.id,
          ${context.ref},
          ${context.sha},
          ${context.runId},
          ${context.runAttempt},
          ${context.jobName}
        from repo
        where (
          select count(*)
          from upload_requests other
          where
            other.repo_id = repo.id
            and other.actions_run_id = ${context.runId}
            and other.actions_run_attempt = ${context.runAttempt}
            and other.job_name = ${context.jobName}
        ) < 10
        returning upload_requests.*
      `,
    )

    console.log('uploadRequest', insertedUploadRequest)

    if (!insertedUploadRequest) {
      const message = `Upload request not created, this may be due to rate limiting on repo ${htmlUrl} / ${context.runId}.`
      return NextResponse.json({message}, {status: 429})
    }

    // todo: replace with sponsorship check?
    if (process.env.ALLOWED_GITHUB_OWNERS && !process.env.ALLOWED_GITHUB_OWNERS.split(',').includes(owner)) {
      const message = `Unauthorized - not allowed to upload to ${owner}/${repo}. Update env.ALLOWED_GITHUB_OWNERS to allow this repo.`
      return NextResponse.json({message}, {status: 401})
    }

    const github = new Octokit({auth: body.clientPayload.githubToken, log: console})

    const {data: repoData} = await github.rest.repos.get({owner, repo}).catch(nullify404)

    if (!repoData) {
      const message = `Repository not found - you may not have access to ${owner}/${repo}. If this repository is private, you will need to pass a "githubToken" in the client payload.`
      throw new ResponseError(NextResponse.json({message}, {status: 404}))
    }

    try {
      const results = await Promise.all(
        body.files.map(async ({pathname, multipart}) => {
          const uploadResponse = await handleUploadSingle(
            request,
            {
              type: 'blob.generate-client-token',
              payload: {
                callbackUrl: body.callbackUrl,
                clientPayload: JSON.stringify(body.clientPayload),
                pathname,
                multipart,
              },
            },
            insertedUploadRequest.id,
          )
          return {pathname, clientToken: uploadResponse.clientToken} satisfies BulkResponseItem
        }),
      )
      return NextResponse.json({results} satisfies BulkResponse)
    } catch (error) {
      if (error instanceof ResponseError) {
        console.log(error.response.status + ' handling upload', error)
        return error.response
      }
      console.error('Error handling upload', error)
      return NextResponse.json({error: 'Error handling upload: ' + String(error)}, {status: 500})
    }
  }

  try {
    const jsonResponse = await handleUploadSingle(request, requestBody, null)

    return NextResponse.json(jsonResponse)
  } catch (error) {
    if (error instanceof ResponseError) {
      console.log(
        'Sending error response',
        JSON.stringify(
          {
            request: {url: request.url, body: (await request.clone().json()) as {}},
            status: error.response.status,
            response: (await error.response.clone().json()) as {},
          },
          null,
          2,
        ),
      )
      return error.response
    }
    console.error('Error handling upload', error)
    return NextResponse.json(
      {error: 'Error handling upload: ' + String(error)},
      {status: 500}, // The webhook will retry 5 times waiting for a 200
    )
  }
}

const handleUploadSingle = async <Type extends HandleUploadBody['type']>(
  request: Request,
  body: Extract<HandleUploadBody, {type: Type}>,
  uploadRequestId: Id<'upload_requests'> | null,
) => {
  const result = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname, payload) => {
      console.log('onBeforeGenerateToken', pathname, payload)

      if (!uploadRequestId) {
        const message = 'Unauthorized - no upload request specified in client payload'
        throw new ResponseError(NextResponse.json({message}, {status: 401}))
      }

      const mimeType = getMimeType(pathname)

      if (!isAllowedContentType(mimeType)) {
        throw new ResponseError(
          NextResponse.json(
            {message: `Unsupported content type for ${pathname} - ${mimeType}`}, //
            {status: 400},
          ),
        )
      }

      const parsedClientPayload = ClientPayload.safeParse(typeof payload === 'string' ? JSON.parse(payload) : payload)

      if (!parsedClientPayload.success) {
        throw new ResponseError(
          NextResponse.json(
            {message: 'Invalid client payload', error: parsedClientPayload.error}, //
            {status: 400},
          ),
        )
      }

      // todo(paid): allow more stringent checks like making sure the ref exists

      return {
        allowedContentTypes: [mimeType],
        addRandomSuffix: false, // todo(paid): allow this to be configurable?
        tokenPayload: tokenPayloadCodec.stringify({
          uploadRequestId,
          ...parsedClientPayload.data.commit,
        }),
      }
    },
    onUploadCompleted: async ({blob, tokenPayload}) => {
      // Get notified of client upload completion
      // ⚠️ This will not work on `localhost` websites,
      // Use ngrok or similar to get the full upload flow
      const payload = tokenPayloadCodec.parse(tokenPayload || '{}')
      if (!payload?.uploadRequestId) {
        throw new ResponseError(
          NextResponse.json(
            {message: 'Unauthorized - no repo specified in client payload'}, //
            {status: 401},
          ),
        )
      }
      const upload = await client.one(
        sql<queries.Upload>`
          insert into uploads (
            pathname,
            mime_type,
            blob_url,
            upload_request_id
          )
          values (
            ${blob.pathname},
            ${getMimeType(blob.pathname)},
            ${blob.url},
            ${payload.uploadRequestId}
          )
          returning uploads.*
        `,
      )

      console.log('upload inserted:', upload)

      console.log('blob upload completed', blob, tokenPayload)

      try {
        // Run any logic after the file upload completed
        // const { userId } = JSON.parse(tokenPayload);
        // await db.update({ avatar: blob.url, userId });
      } catch {
        throw new Error('Could not update user')
      }
    },
  })

  return result as Extract<typeof result, {type: Type}>
}

async function getJobsWithStatuses(context: GithubActionsContext) {
  const [owner, repo] = context.repository.split('/')

  const runPathname = `/${owner}/${repo}/actions/runs/${context.runId}`
  const runPageUrl = `${context.githubOrigin}${runPathname}`
  const runPageHtml = await fetch(runPageUrl).then(r => r.text())
  const $ = cheerio.load(runPageHtml)

  const jobAnchors = $(`run-summary a[href^="${runPathname}/job/"]`)
  const jobs = jobAnchors.map((_, el) => {
    const $el = $(el)
    return {
      href: $el.attr('href'),
      jobName: $el.text().trim(),
      isRunning: $el.find('svg[aria-label*="currently running"]').length > 0,
      isFailed: $el.find('svg[aria-label*="failed"]').length > 0,
      isSuccess: $el.find('svg[aria-label*="completed successfully"]').length > 0,
      html: $el.html(),
    }
  })
  return jobs
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `with repo as ( insert into repos (owner,... [truncated] ...= $11 ) < 10 returning upload_requests.*` */
  export interface UploadRequest {
    /** column: `public.upload_requests.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'upload_requests'>

    /** column: `public.upload_requests.repo_id`, not null: `true`, regtype: `prefixed_ksuid` */
    repo_id: string

    /** column: `public.upload_requests.ref`, not null: `true`, regtype: `text` */
    ref: string

    /** column: `public.upload_requests.sha`, not null: `true`, regtype: `text` */
    sha: string

    /** column: `public.upload_requests.actions_run_id`, not null: `true`, regtype: `bigint` */
    actions_run_id: number

    /** column: `public.upload_requests.actions_run_attempt`, not null: `true`, regtype: `integer` */
    actions_run_attempt: number

    /** column: `public.upload_requests.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.upload_requests.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date

    /** column: `public.upload_requests.job_name`, not null: `true`, regtype: `text` */
    job_name: string
  }

  /** - query: `insert into uploads ( pathname, mime_type, blob_url, upload_request_id ) values ( $1, $2, $3, $4 ) returning uploads.*` */
  export interface Upload {
    /** column: `public.uploads.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'uploads'>

    /** column: `public.uploads.pathname`, not null: `true`, regtype: `text` */
    pathname: string

    /** column: `public.uploads.mime_type`, not null: `true`, regtype: `text` */
    mime_type: string

    /** column: `public.uploads.blob_url`, not null: `true`, regtype: `text` */
    blob_url: string

    /** column: `public.uploads.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.uploads.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date

    /** column: `public.uploads.upload_request_id`, not null: `true`, regtype: `prefixed_ksuid` */
    upload_request_id: string
  }
}
