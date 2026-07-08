import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import handler, {createServerEntry} from '@tanstack/react-start/server-entry'
import {resolveArtifactForEdge} from './artifacts/resolve'
import {getRequestSession} from './auth/request-session'
import {createServerAuth} from './auth/server-auth'
import {type AppEnv, runWithAppEnv} from './cloudflare-env'
import {handleWebhookRequest} from './github/events'
import {handleUploadRequest} from './github/upload'
import {handleTrpcRequest} from './trpc/server'

const serverEntry = createServerEntry({
  fetch: (async (request: Request, env: AppEnv): Promise<Response> => {
    return runWithAppEnv(env, () => handleRequest(request))
  }) as never,
})

export default {
  ...serverEntry,
  // cron: poll Depot CI for new runs/artifacts (Depot has no webhooks)
  scheduled: (controller: unknown, env: AppEnv, ctx: {waitUntil(promise: Promise<unknown>): void}) => {
    ctx.waitUntil(
      Promise.resolve().then(() =>
        runWithAppEnv(env, async () => {
          const {syncAllDepotConnections} = await import('./depot/sync')
          const origin = env.PUBLIC_DEV_URL || env.BETTER_AUTH_URL
          const results = await syncAllDepotConnections({origin})
          console.log('[depot-sync] scheduled sync complete', JSON.stringify(results).slice(0, 1000))
        }),
      ),
    )
  },
}

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

  if (url.pathname === '/api/depot/sync' && request.method === 'POST') {
    const session = await getRequestSession(request)
    if (!session.githubLogin) return Response.json({error: 'not authenticated'}, {status: 401})
    const {syncAllDepotConnections} = await import('./depot/sync')
    const {getArtifactOrigin} = await import('./github/origin')
    const results = await syncAllDepotConnections({origin: getArtifactOrigin(request)})
    return Response.json({ok: true, results})
  }

  if (url.pathname.startsWith('/api/depot/artifact-zip/') && request.method === 'GET') {
    const {handleDepotArtifactZipRequest} = await import('./depot/zip')
    return handleDepotArtifactZipRequest(request)
  }

  if (url.pathname === '/api/internal/artifacts/resolve' && request.method === 'POST') {
    const payload = (await request.json()) as ArtifactResolveRequest
    const session = await getRequestSession(request)
    const body: ArtifactResolveResponse = await resolveArtifactForEdge(payload, session.githubLogin)
    return Response.json(body)
  }

  return handler.fetch(request)
}
