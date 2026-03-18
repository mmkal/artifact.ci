import {handleArtifactRequest, type ArtifactHandlerEnv} from './artifact-handler'
import {routeRequest} from './routing'

export interface FrontdoorEnv extends ArtifactHandlerEnv {
  APP: {fetch(request: Request): Promise<Response>}
  DOCS: {fetch(request: Request): Promise<Response>}
  APP_URL: string
  DOCS_URL: string
}

const proxyToOrigin = (request: Request, origin: string) => {
  const url = new URL(request.url)
  return fetch(new Request(new URL(`${url.pathname}${url.search}`, origin), request))
}

export default {
  async fetch(request: Request, env: FrontdoorEnv): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return proxyToOrigin(request, env.APP_URL)
    }

    const target = routeRequest(url.pathname)

    if (target === 'artifact') {
      return handleArtifactRequest(request, env)
    }

    if (target === 'app') {
      return env.APP.fetch(request)
    }

    return proxyToOrigin(request, env.DOCS_URL)
  },
}
