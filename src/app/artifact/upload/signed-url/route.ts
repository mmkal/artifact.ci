import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import {lookup as mimeLookup} from 'mime-types'
import {NextResponse} from 'next/server'
import {getJobsWithStatuses as loadWorkflowJobStatuses} from './job-statuses'
import {BulkRequest, BulkResponse, BulkResponseItem, ClientPayload, tokenPayloadCodec} from './types'
import {nullify404} from '~/app/artifact/browse/[...slug]/route'
import {client, Id, sql} from '~/db'

export const maxDuration = 59

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

  console.warn(`New content type - ${mimeType} - pls add to allowed content types. Allowing anyway for now`)
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

    const ctx = body.clientPayload.context
    const [owner, repo] = ctx.repository.split('/')
    const htmlUrl = `${ctx.githubOrigin}/${owner}/${repo}`

    const jobsResult = await loadWorkflowJobStatuses(ctx)
    if (!jobsResult.success) {
      const message = `Failed to load job statuses for ${ctx.job} on ${htmlUrl}. If this is a private repo, you may need to pass a "githubToken" in the client payload.`
      return NextResponse.json(
        {message, error: jobsResult.response.statusText},
        {status: jobsResult.response.status === 404 ? 404 : 500},
      )
    }
    const {jobs} = jobsResult
    console.log('loadWorkflowJobStatuses result', jobs)

    const matchingJob = jobsResult.jobs[ctx.job]

    if (!matchingJob || matchingJob.status !== 'running') {
      const message = `Job ${ctx.job} not found or was not running. Job info: ${JSON.stringify(jobs, null, 2)}`
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
        insert into upload_requests (repo_id, ref, sha, actions_run_id, actions_run_attempt, job_id)
        select repo.id, ${ctx.ref}, ${ctx.sha}, ${ctx.runId}, ${ctx.runAttempt}, ${ctx.job}
        from repo
        where (
          select count(*)
          from upload_requests existing
          where
            existing.repo_id = repo.id
            and existing.actions_run_id = ${ctx.runId}
            and existing.actions_run_attempt = ${ctx.runAttempt}
            and existing.job_id = ${ctx.job}
        ) < 1
        returning upload_requests.*
      `,
    )

    console.log('uploadRequest', insertedUploadRequest)

    if (!insertedUploadRequest) {
      const message = `Upload request not created, this may be due to rate limiting on repo ${htmlUrl} / ${ctx.runId}.`
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
    },
  })

  return result as Extract<typeof result, {type: Type}>
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `with repo as ( insert into repos (owner,... [truncated] ... = $11 ) < 1 returning upload_requests.*` */
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

    /** column: `public.upload_requests.job_id`, not null: `true`, regtype: `text` */
    job_id: string
  }

  /** - query: `insert into uploads ( pathname, mime_type, blob_url, upload_request_id ) values ( $1, $2, $3, $4 ) returning uploads.*` */
  export interface Upload {
    /** column: `public.uploads.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'uploads'>

    /**
     * looks like `/[owner]/[repo]/[runId]/[...filepath]`
     *
     * column: `public.uploads.pathname`, not null: `true`, regtype: `text`
     */
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
