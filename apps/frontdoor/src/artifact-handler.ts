import {buildArtifactFileResponse} from '@artifact/domain/artifact/build-file-response'
import {
  type ArtifactResolveRequest,
  type ArtifactResolveResponse,
} from '@artifact/domain/artifact/edge-contract'
import {PathParams, toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {ARTIFACT_BLOB_ROUTE_PREFIX, LEGACY_ARTIFACT_VIEW_PREFIX} from '@artifact/config/routes'

export interface ArtifactHandlerEnv {
  APP: {fetch(request: Request): Promise<Response>}
  SUPABASE_PROJECT_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export async function handleArtifactRequest(request: Request, env: ArtifactHandlerEnv): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === LEGACY_ARTIFACT_VIEW_PREFIX.slice(0, -1)) {
    return Response.redirect(new URL('/app/artifacts', url.origin), 308)
  }

  if (url.pathname.startsWith(LEGACY_ARTIFACT_VIEW_PREFIX)) {
    const nextPath = toAppArtifactPath(parseLegacyViewPath(url.pathname))
    return Response.redirect(new URL(withSearch(nextPath, url.search), url.origin), 308)
  }

  if (!url.pathname.startsWith(ARTIFACT_BLOB_ROUTE_PREFIX)) {
    return Response.json(
      {
        message: 'Unsupported artifact route.',
        supportedPrefixes: [ARTIFACT_BLOB_ROUTE_PREFIX, LEGACY_ARTIFACT_VIEW_PREFIX],
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

  const response = await env.APP.fetch(
    new Request(internalUrl, {
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

function parseLegacyViewPath(pathname: string) {
  const segments = pathname.slice(LEGACY_ARTIFACT_VIEW_PREFIX.length).split('/').filter(Boolean)
  const [owner, repo, aliasType, identifier, artifactName, ...filepath] = segments
  return PathParams.parse({owner, repo, aliasType, identifier, artifactName, filepath})
}

function withSearch(pathname: string, search: string) {
  return `${pathname}${search}`
}
