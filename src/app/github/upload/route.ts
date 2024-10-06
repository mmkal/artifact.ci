import {NextRequest, NextResponse} from 'next/server'
import {App} from 'octokit'
import {z} from 'zod'
import {fromError} from 'zod-validation-error'
import {logger} from '~/tag-logger'
import {BulkRequest} from '~/types'

export const UploadRequest = z.object({})

export async function POST(request: NextRequest) {
  const rawBody = (await request.json()) as {}
  const parsed = BulkRequest.safeParse(rawBody)
  if (!parsed.success) {
    const readable = fromError(parsed.error)
    logger.error({readable, body: rawBody})
    return NextResponse.json({error: readable.message}, {status: 400})
  }
  const body = parsed.data
  const {context} = body.clientPayload
  const [owner, _repo] = context.repository.split('/')
  logger.debug({body})

  const env = Env.parse(process.env)
  const app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  })

  // is there really no way to get an installation by repo name?
  const {data: allInstallations} = await app.octokit.rest.apps.listInstallations()
  const installation = allInstallations.find(i => i.account?.login === owner)
  if (!installation) {
    return NextResponse.json({error: 'installation not found'}, {status: 404})
  }

  const octokit = await app.getInstallationOctokit(installation.id)
  const {data: _repos} = await octokit.rest.apps.listReposAccessibleToInstallation()

  // todo: get a token for the github app like this does: https://github.com/actions/create-github-app-token
  // docs which ref that: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow

  return NextResponse.json({a: 1})
}

const Env = z.object({
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
})
