import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import handler, {createServerEntry} from '@tanstack/react-start/server-entry'
import {resolveArtifactForEdge} from './artifacts/resolve'
import {getRequestSession} from './auth/request-session'
import {createServerAuth} from './auth/server-auth'

export default createServerEntry({
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/auth/')) {
      const auth = createServerAuth()
      return auth.handler(request)
    }

    if (url.pathname === '/api/internal/artifacts/resolve' && request.method === 'POST') {
      const payload = (await request.json()) as ArtifactResolveRequest
      const session = await getRequestSession(request)
      const body: ArtifactResolveResponse = await resolveArtifactForEdge(payload, session.githubLogin)
      return Response.json(body)
    }

    return handler.fetch(request)
  },
})
