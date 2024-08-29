import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import {NextResponse} from 'next/server'
import {z} from 'zod'
import {nullify404} from '../../browse/[...slug]/route'

class ResponseError extends Error {
  constructor(readonly response: NextResponse) {
    super()
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, payload) => {
        console.log('onBeforeGenerateToken', pathname, payload)
        const ClientPayloadSchema = z.object({
          githubToken: z.string(),
          owner: z.string().regex(/^[^/]+$/),
          repo: z.string().regex(/^[^/]+$/),
          run_id: z.number(),
        })
        const parsedClientPayload = ClientPayloadSchema.safeParse(
          typeof payload === 'string' ? JSON.parse(payload) : payload,
        )

        if (!parsedClientPayload.success) {
          throw new ResponseError(
            NextResponse.json({message: 'Unauthorized - no token specified in client payload'}, {status: 401}),
          )
        }

        const {owner, repo, githubToken} = parsedClientPayload.data

        const octokit = new Octokit({auth: githubToken, log: console})

        // // make sure the token is allowed by github to access the specified run
        // const {data: run, ...rest} = await octokit.rest.actions
        //   .getWorkflowRun({
        //     owner: clientPayload.owner,
        //     repo: clientPayload.repo,
        //     run_id: clientPayload.run_id,
        //   })
        //   .catch((error: unknown) => ({data: null, error}))
        //   .then(result => ({...result, error: null}))
        const {data: repoData} = await octokit.rest.repos.get({owner, repo}).catch(nullify404)

        // Check if the token has push access
        const hasPushAccess = repoData?.permissions?.push === true

        if (!hasPushAccess) {
          const message = `Forbidden - token provided doesn't have push access to ${owner}/${repo}. Permissions: ${JSON.stringify(repoData?.permissions)}`
          throw new ResponseError(NextResponse.json({message}, {status: 403}))
        }

        return {
          // todo: allow more, maybe for paid users?
          allowedContentTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'text/plain',
            'text/html',
            'text/css',
            'text/javascript',
            'application/json',
          ],
          tokenPayload: JSON.stringify({
            permissions: repoData?.permissions,
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
