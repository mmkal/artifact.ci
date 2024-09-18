import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import {lookup as mimeLookup} from 'mime-types'
import {NextResponse} from 'next/server'
import {z} from 'zod'
import {nullify404} from '~/app/artifact/browse/[...slug]/route'
import {client, Id, sql} from '~/db'

const CommitProps = z.object({
  ref: z.string(),
  sha: z.string(),
})
type CommitProps = z.infer<typeof CommitProps>

const ClientPayload = z.object({
  githubToken: z.string(),
  commit: CommitProps,
})

const TokenPayload = CommitProps.extend({
  repoId: Id('repos'),
})

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
  constructor(readonly response: NextResponse) {
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
  '*/*', // todo(paid): only allow this for paid users?
])

const isAllowedContentType = (mimeType: string) => {
  if (allowedContentTypes.has(mimeType)) return true

  console.warn(`New content type - ${mimeType} - add to allowed content types. Allowing anyway for now`)
  return true
}

const getMimeType = (pathname: string) => mimeLookup(pathname) || 'text/plain'

export async function POST(request: Request): Promise<NextResponse> {
  // todo: bulk endpoint - send a list of files to upload and get a list of signed URL tokens back
  const body = (await request.json()) as HandleUploadBody
  console.log(JSON.stringify({url: request.url, body, headers: Object.fromEntries(request.headers)}, null, 2))

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, payload) => {
        console.log('onBeforeGenerateToken', pathname, payload)

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
              {message: 'Unauthorized - no token specified in client payload'}, //
              {status: 401},
            ),
          )
        }

        const {githubToken} = parsedClientPayload.data
        const [owner, repo] = pathname.split('/')

        if (process.env.ALLOWED_GITHUB_OWNERS && !process.env.ALLOWED_GITHUB_OWNERS.split(',').includes(owner)) {
          const message = `Unauthorized - not allowed to upload to ${owner}/${repo}. Update env.ALLOWED_GITHUB_OWNERS to allow this repo.`
          throw new ResponseError(NextResponse.json({message}, {status: 401}))
        }

        const github = new Octokit({auth: githubToken, log: console})

        const {data: repoData} = await github.rest.repos.get({owner, repo}).catch(nullify404)

        if (!repoData) {
          throw new ResponseError(
            NextResponse.json(
              {message: `Repository not found - you may not have access to ${owner}/${repo}`},
              {status: 404},
            ),
          )
        }

        const dbRepo = await client.one(
          sql<queries.Repo>`
            insert into repos (owner, name, html_url)
            values (${owner}, ${repo}, ${repoData.html_url})
            on conflict (html_url) do update set updated_at = current_timestamp
            returning id
          `,
        )

        console.log('dbRepo', dbRepo)

        // todo(paid): allow more stringent checks like making sure the ref exists

        return {
          allowedContentTypes: [mimeType],
          addRandomSuffix: false, // todo(paid): allow this to be configurable
          tokenPayload: tokenPayloadCodec.stringify({
            repoId: dbRepo.id,
            ...parsedClientPayload.data.commit,
          }),
        }
      },
      onUploadCompleted: async ({blob, tokenPayload}) => {
        // Get notified of client upload completion
        // ⚠️ This will not work on `localhost` websites,
        // Use ngrok or similar to get the full upload flow
        const payload = tokenPayloadCodec.parse(tokenPayload || '{}')
        if (!payload?.repoId) {
          throw new ResponseError(
            NextResponse.json(
              {message: 'Unauthorized - no repo specified in client payload'}, //
              {status: 401},
            ),
          )
        }
        const upload = await client.one(
          sql<queries.Upload>`
            insert into uploads (pathname, mime_type, blob_url, repo_id, ref, sha)
            values (
              ${blob.pathname},
              ${getMimeType(blob.pathname)},
              ${blob.url},
              ${payload.repoId},
              ${payload.ref},
              ${payload.sha}
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

    return NextResponse.json(jsonResponse)
  } catch (error) {
    if (error instanceof ResponseError) {
      return error.response
    }
    console.error('Error handling upload', error)
    return NextResponse.json(
      {error: 'Error handling upload: ' + String(error)},
      {status: 500}, // The webhook will retry 5 times waiting for a 200
    )
  }
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `insert into repos (owner, name, html_url... [truncated] ...ated_at = current_timestamp returning id` */
  export interface Repo {
    /** column: `public.repos.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'repos'>
  }

  /** - query: `insert into uploads (pathname, mime_type, blob_url, repo_id) values ($1, $2, $3, $4) returning uploads.*` */
  export interface Upload {
    /** column: `public.uploads.id`, not null: `true`, regtype: `prefixed_ksuid` */
    id: import('~/db').Id<'uploads'>

    /** column: `public.uploads.pathname`, not null: `true`, regtype: `text` */
    pathname: string

    /** column: `public.uploads.mime_type`, not null: `true`, regtype: `text` */
    mime_type: string

    /** column: `public.uploads.blob_url`, not null: `true`, regtype: `text` */
    blob_url: string

    /** column: `public.uploads.repo_id`, not null: `true`, regtype: `prefixed_ksuid` */
    repo_id: string

    /** column: `public.uploads.created_at`, not null: `true`, regtype: `timestamp with time zone` */
    created_at: Date

    /** column: `public.uploads.updated_at`, not null: `true`, regtype: `timestamp with time zone` */
    updated_at: Date
  }
}
