import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import {lookup as mimeLookup} from 'mime-types'
import {NextResponse} from 'next/server'
import {z} from 'zod'
import {nullify404} from '../../browse/[...slug]/route'

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

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, payload) => {
        console.log('onBeforeGenerateToken', pathname, payload)

        const mimeType = mimeLookup(pathname) || 'text/plain'

        // if (!allowedContentTypes.has(mimeType)) {
        //   throw new ResponseError(
        //     NextResponse.json(
        //       {message: `Unsupported content type for ${pathname} - ${mimeType}`}, //
        //       {status: 400},
        //     ),
        //   )
        // }

        const ClientPayloadSchema = z.object({
          githubToken: z.string(),
        })
        const parsedClientPayload = ClientPayloadSchema.safeParse(
          typeof payload === 'string' ? JSON.parse(payload) : payload,
        )

        if (!parsedClientPayload.success) {
          throw new ResponseError(
            NextResponse.json({message: 'Unauthorized - no token specified in client payload'}, {status: 401}),
          )
        }

        const {githubToken} = parsedClientPayload.data
        const [owner, repo] = pathname.split('/')

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

        // todo(paid): allow more stringent checks like making sure the ref exists

        return {
          allowedContentTypes: [mimeType],
          addRandomSuffix: false, // todo(paid): allow this to be configurable
          tokenPayload: JSON.stringify({
            repo: repoData && {
              html_url: repoData.html_url,
              permissions: repoData.permissions,
            },
          }),
        }
      },
      onUploadCompleted: async ({blob, tokenPayload}) => {
        // Get notified of client upload completion
        // ⚠️ This will not work on `localhost` websites,
        // Use ngrok or similar to get the full upload flow

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
