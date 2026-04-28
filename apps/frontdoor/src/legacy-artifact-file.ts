const ARTIFACT_BLOB_ROUTE_PREFIX = '/artifact/blob/'
const ARTIFACT_VIEW_ROUTE_PREFIX = '/artifact/view/'
const artifactViewPathSegmentCount = 5

export function getLegacyArtifactFileRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const url = new URL(request.url)
  if (!url.pathname.startsWith(ARTIFACT_VIEW_ROUTE_PREFIX)) return null

  const pathSuffix = url.pathname.slice(ARTIFACT_VIEW_ROUTE_PREFIX.length)
  const segments = pathSuffix.split('/').filter(Boolean)
  if (segments.length <= artifactViewPathSegmentCount) return null

  url.pathname = `${ARTIFACT_BLOB_ROUTE_PREFIX}${pathSuffix}`
  return Response.redirect(url, 308)
}
