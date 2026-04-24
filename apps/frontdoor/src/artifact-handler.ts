import {buildArtifactFileResponse} from '@artifact/domain/artifact/build-file-response'
import {
  type ArtifactResolveRequest,
  type ArtifactResolveResponse,
} from '@artifact/domain/artifact/edge-contract'
import {PathParams} from '@artifact/domain/artifact/path-params'
import {ARTIFACT_BLOB_ROUTE_PREFIX} from '@artifact/config/routes'

export interface ArtifactHandlerEnv {
  APP: {fetch(request: Request): Promise<Response>}
  /**
   * Optional public URL for the app worker. In local dev the app is vite
   * (http://127.0.0.1:43111), not a real Worker, so env.APP service-binding
   * calls fail with "Blocked request" inside miniflare. When APP_URL is a
   * local http:// origin we bypass the service binding and fetch directly.
   */
  APP_URL?: string
  SUPABASE_PROJECT_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

const isLocalHttpOrigin = (origin: string | undefined) =>
  Boolean(origin) && /^https?:\/\/(127\.0\.0\.1|localhost):\d+/.test(origin!)

export async function handleArtifactRequest(request: Request, env: ArtifactHandlerEnv): Promise<Response> {
  const url = new URL(request.url)

  if (!url.pathname.startsWith(ARTIFACT_BLOB_ROUTE_PREFIX)) {
    return Response.json(
      {
        message: 'Unsupported artifact route (only /artifact/blob/* is served by the artifact worker; /artifact/view/* is rendered by the app).',
        supportedPrefixes: [ARTIFACT_BLOB_ROUTE_PREFIX],
      },
      {status: 404},
    )
  }

  const params = parseBlobPath(url.pathname)
  const raw = url.searchParams.get('raw') === 'true'
  const resolveResult = await resolveArtifactRequestViaApp(request, env, {
    params,
    requestPathname: url.pathname,
    raw,
  })

  if (resolveResult.kind === 'redirect') {
    return Response.redirect(new URL(resolveResult.location, url.origin), resolveResult.status)
  }

  if (resolveResult.kind === 'json') {
    return Response.json(resolveResult.body, {status: resolveResult.status})
  }

  return buildArtifactFileResponse(
    resolveResult.storagePathname,
    resolveResult.params,
    {
      getObjectResponse: storagePathname => fetchSupabaseObject(storagePathname, env),
    },
    {raw: resolveResult.raw},
  )
}

async function resolveArtifactRequestViaApp(
  request: Request,
  env: ArtifactHandlerEnv,
  body: ArtifactResolveRequest,
): Promise<ArtifactResolveResponse> {
  const url = new URL(request.url)
  const internalUrl = new URL('/api/internal/artifacts/resolve', url.origin)
  const headers = new Headers({
    'content-type': 'application/json',
  })

  copyHeader(request.headers, headers, 'cookie')
  copyHeader(request.headers, headers, 'user-agent')
  copyHeader(request.headers, headers, 'accept-language')
  headers.set('x-artifact-origin', url.origin)

  const targetUrl = isLocalHttpOrigin(env.APP_URL)
    ? new URL(internalUrl.pathname + internalUrl.search, env.APP_URL)
    : internalUrl
  const fetcher = isLocalHttpOrigin(env.APP_URL) ? fetch : env.APP.fetch.bind(env.APP)

  const response = await fetcher(
    new Request(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )

  const payload = (await response.json()) as ArtifactResolveResponse
  return payload
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name)
  if (value) target.set(name, value)
}

async function fetchSupabaseObject(storagePathname: string, env: ArtifactHandlerEnv) {
  const encodedSegments = storagePathname.split('/').map(encodeURIComponent).join('/')
  return fetch(`${env.SUPABASE_PROJECT_URL}/storage/v1/object/artifact_files/${encodedSegments}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
}

function parseBlobPath(pathname: string) {
  const segments = pathname.slice(ARTIFACT_BLOB_ROUTE_PREFIX.length).split('/').filter(Boolean)
  const [owner, repo, aliasType, identifier, artifactName, ...filepath] = segments
  return PathParams.parse({owner, repo, aliasType, identifier, artifactName, filepath})
}

