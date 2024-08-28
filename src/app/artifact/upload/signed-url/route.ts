import {Octokit} from '@octokit/rest'
import {handleUpload, type HandleUploadBody} from '@vercel/blob/client'
import {NextResponse} from 'next/server'

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        console.log('onBeforeGenerateToken', pathname, clientPayload)
        const token =
          typeof clientPayload === 'string' && clientPayload.startsWith('{')
            ? (JSON.parse(clientPayload).githubToken as string)
            : null

        if (!token) return NextResponse.json({message: 'Bad request - no token'}, {status: 400})

        const octokit = new Octokit({auth: token, log: console})

        const {data: authedGitHubUser} = await octokit.rest.users.getAuthenticated()

        if (!authedGitHubUser) {
          // return NextResponse.json({message: `Unauthorized - couldn't get user from token`}, {status: 401})
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
            authedGitHubUser,
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
    console.error('Error handling upload', error)
    return NextResponse.json(
      {error: (error as Error).message},
      {status: 400}, // The webhook will retry 5 times waiting for a 200
    )
  }
}
