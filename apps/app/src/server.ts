import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import handler, {createServerEntry} from '@tanstack/react-start/server-entry'
import {resolveArtifactForEdge} from './artifacts/resolve'
import {getRequestSession} from './auth/request-session'
import {createServerAuth} from './auth/server-auth'
import {handleWebhookRequest} from './github/events'
import {handleUploadRequest} from './github/upload'
import {type AppEnv, runWithAppEnv} from './cloudflare-env'
import {handleTrpcRequest} from './trpc/server'

export default createServerEntry({
  fetch: (async (request: Request, env: AppEnv): Promise<Response> => {
    return runWithAppEnv(env, () => handleRequest(request))
  }) as never,
})

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/test') {
    return Response.json({testTableData: {id: 1, name: 'one'}})
  }

  if (url.pathname.startsWith('/api/auth/')) {
    const auth = createServerAuth()
    return auth.handler(request)
  }

  if (url.pathname.startsWith('/api/trpc/')) {
    return handleTrpcRequest(request)
  }

  if (url.pathname === '/github/upload' && request.method === 'POST') {
    return handleUploadRequest(request)
  }

  if (url.pathname === '/github/events' && request.method === 'POST') {
    return handleWebhookRequest(request)
  }

  if (url.pathname === '/api/internal/artifacts/resolve' && request.method === 'POST') {
    const payload = (await request.json()) as ArtifactResolveRequest
    const session = await getRequestSession(request)
    const body: ArtifactResolveResponse = await resolveArtifactForEdge(payload, session.githubLogin)
    return Response.json(body)
  }

  return handler.fetch(request)
}
