const CANONICAL_HOST = 'artifact.ci'
const WWW_HOST = 'www.artifact.ci'
const WWW_PASSTHROUGH_PREFIXES = ['/api', '/github']

const matchesRoutePrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

export const getWwwToApexRedirect = (request: Request): Response | null => {
  const url = new URL(request.url)
  if (url.hostname !== WWW_HOST) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (WWW_PASSTHROUGH_PREFIXES.some(prefix => matchesRoutePrefix(url.pathname, prefix))) return null

  url.hostname = CANONICAL_HOST
  return Response.redirect(url, 308)
}
