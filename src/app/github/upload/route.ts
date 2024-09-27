import {NextRequest, NextResponse} from 'next/server'
import {fromError} from 'zod-validation-error'
import {getLogger} from '~/action'
import {BulkRequest} from '~/types'

export async function POST(request: NextRequest) {
  const logger = getLogger({debug: request.headers.get('artifactci-debug') === 'true'})
  const rawBody = (await request.json()) as {}
  const parsed = BulkRequest.safeParse(rawBody)
  if (!parsed.success) {
    const readable = fromError(parsed.error)
    logger.error({readable, body: rawBody})
    return NextResponse.json({error: readable.message}, {status: 400})
  }

  const body = parsed.data
  logger.debug({body})

  // todo: get a token for the github app like this does: https://github.com/actions/create-github-app-token
  // docs which ref that: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow

  return NextResponse.json({a: 1})
}
