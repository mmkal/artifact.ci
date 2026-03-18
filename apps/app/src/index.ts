import {type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/internal/artifacts/resolve') {
      const body: ArtifactResolveResponse = {
        kind: 'json',
        status: 501,
        body: {message: 'Artifact resolver not wired into the TanStack app yet.'},
      }
      return Response.json(body, {status: 501})
    }

    return new Response('TanStack Start app worker not wired yet.', {status: 503})
  },
}
