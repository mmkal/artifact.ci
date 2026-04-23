import {handleArtifactRequest, type ArtifactHandlerEnv} from './artifact-handler'
import {routeRequest} from './routing'

export interface FrontdoorEnv extends ArtifactHandlerEnv {
  APP: {fetch(request: Request): Promise<Response>}
  DOCS: {fetch(request: Request): Promise<Response>}
  APP_URL: string
  DOCS_URL: string
}

const APP_DEV_PREFIX = '/__app_proxy__'
const VITE_DEV_PREFIXES = ['/@vite/', '/__vite']

const proxyToOrigin = async (request: Request, origin: string) => {
  const url = new URL(request.url)
  return fetch(new Request(new URL(`${url.pathname}${url.search}`, origin), request))
}

const proxyToFirstAvailable = async (request: Request, origins: string[]) => {
  for (const origin of origins.filter(Boolean)) {
    const response = await proxyToOrigin(request, origin)
    if (response.status !== 404) {
      return response
    }
  }

  return new Response('Not Found', {status: 404})
}

const isLocalOrigin = (origin: string) => /^https?:\/\/(127\.0\.0\.1|localhost):\d+/.test(origin)
const DEV_ASSET_PREFIXES = [
  '/src/',
  '/@id/',
  '/@vite/',
  '/@react-refresh',
  '/@fs/',
  '/@tanstack-start/',
  '/node_modules/',
  '/__vite',
]

const isDevAssetPath = (pathname: string) => DEV_ASSET_PREFIXES.some(prefix => pathname.startsWith(prefix))

const getRefererTarget = (request: Request) => {
  const referer = request.headers.get('referer')
  if (!referer) return null

  try {
    const refererPathname = new URL(referer).pathname
    if (refererPathname.startsWith(APP_DEV_PREFIX)) return 'app'
    return routeRequest(refererPathname)
  } catch {
    return null
  }
}

const isWebsocketUpgrade = (request: Request) => request.headers.get('upgrade')?.toLowerCase() === 'websocket'
const isViteWebsocketPath = (pathname: string) => VITE_DEV_PREFIXES.some(prefix => pathname.startsWith(prefix))

export default {
  async fetch(request: Request, env: FrontdoorEnv): Promise<Response> {
    try {
      const url = new URL(request.url)

      // Vite's HMR client doesn't survive a Cloudflare Tunnel: the HMR
      // WebSocket's upgrade gets mangled, the client reports "server
      // connection lost", then polls with a "vite-ping" WebSocket to the
      // same URL. As soon as the ping WS looks like it succeeds, the
      // client calls location.reload() — which is the infinite-refresh
      // loop at https://artifactci.dev/<app-route>. hmr:false in
      // vite.config doesn't stop tanstack-start from injecting the
      // client, so we short-circuit the client script itself: return an
      // empty module and the page never sets up HMR or polling.
      if (
        url.pathname === '/@vite/client' ||
        url.pathname === `${APP_DEV_PREFIX}/@vite/client`
      ) {
        return new Response('export {}', {
          status: 200,
          headers: {'content-type': 'application/javascript; charset=utf-8'},
        })
      }

      if (isWebsocketUpgrade(request)) {
        if (url.pathname.startsWith(APP_DEV_PREFIX) || isViteWebsocketPath(url.pathname)) {
          const appPath = url.pathname.startsWith(APP_DEV_PREFIX) ? url.pathname.slice(APP_DEV_PREFIX.length) || '/' : url.pathname
          return proxyToOrigin(new Request(new URL(`${appPath}${url.search}`, env.APP_URL), request), env.APP_URL)
        }

        const refererTarget = getRefererTarget(request)
        if (refererTarget === 'app') {
          return proxyToOrigin(request, env.APP_URL)
        }
        if (refererTarget === 'docs') {
          return proxyToOrigin(request, env.DOCS_URL)
        }
      }

      if (url.pathname === '/app') {
        return Response.redirect(new URL('/login', url.origin), 307)
      }

      if (url.pathname.startsWith(APP_DEV_PREFIX)) {
        const appPath = url.pathname.slice(APP_DEV_PREFIX.length) || '/'
        return proxyAppResponse(new Request(new URL(`${appPath}${url.search}`, env.APP_URL), request), env.APP_URL)
      }

      if (isDevAssetPath(url.pathname)) {
        const refererTarget = getRefererTarget(request)
        if (refererTarget === 'app' && isLocalOrigin(env.APP_URL)) {
          return proxyToOrigin(request, env.APP_URL)
        }
        if (refererTarget === 'docs') {
          return proxyToFirstAvailable(request, [env.DOCS_URL, env.APP_URL])
        }
        return proxyToFirstAvailable(request, [env.APP_URL, env.DOCS_URL])
      }

      const target = routeRequest(url.pathname)

      if (target === 'artifact') {
        return handleArtifactRequest(request, env)
      }

      if (target === 'app') {
        if (isLocalOrigin(env.APP_URL)) {
          return proxyAppResponse(request, env.APP_URL)
        }

        return env.APP.fetch(request)
      }

      return proxyToOrigin(request, env.DOCS_URL)
    } catch (error) {
      console.error('frontdoor request failed', {
        url: request.url,
        method: request.method,
        error: String(error),
      })
      return new Response('Bad Gateway', {status: 502})
    }
  },
}

async function proxyAppResponse(request: Request, origin: string) {
  const response = await proxyToOrigin(request, origin)
  const contentType = response.headers.get('content-type') || ''
  if (!/text\/html/.test(contentType)) {
    return response
  }

  const body = await response.text()
  return new Response(rewriteAppDevAssetUrls(body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function rewriteAppDevAssetUrls(body: string) {
  const prefixes = ['/src/', '/@id/', '/@vite/', '/@react-refresh', '/@fs/', '/@tanstack-start/', '/node_modules/']
  return prefixes.reduce((current, prefix) => current.replaceAll(`"${prefix}`, `"${APP_DEV_PREFIX}${prefix}`), body)
}
