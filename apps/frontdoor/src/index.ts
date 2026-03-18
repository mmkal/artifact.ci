import {handleArtifactRequest, type ArtifactHandlerEnv} from './artifact-handler'
import {routeRequest} from './routing'

export interface FrontdoorEnv extends ArtifactHandlerEnv {
  APP: {fetch(request: Request): Promise<Response>}
  DOCS: {fetch(request: Request): Promise<Response>}
}

export default {
  async fetch(request: Request, env: FrontdoorEnv): Promise<Response> {
    const url = new URL(request.url)
    const target = routeRequest(url.pathname)

    if (target === 'artifact') {
      return handleArtifactRequest(request, env)
    }

    if (target === 'app') {
      return env.APP.fetch(request)
    }

    return env.DOCS.fetch(request)
  },
}
