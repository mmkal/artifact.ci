export const ARTIFACT_ROUTE_PREFIX = '/artifact/'
export const ARTIFACT_BLOB_ROUTE_PREFIX = '/artifact/blob/'
export const LEGACY_ARTIFACT_VIEW_PREFIX = '/artifact/view/'

export const APP_EXACT_ROUTES = ['/login', '/account'] as const

export const APP_ROUTE_PREFIXES = ['/app/', '/api/', '/github/'] as const
export const APP_PREFIX_ROOTS = ['/app', '/api'] as const

export const isArtifactRoute = (pathname: string) => pathname.startsWith(ARTIFACT_ROUTE_PREFIX)

export const isAppRoute = (pathname: string) => {
  if (APP_EXACT_ROUTES.includes(pathname as (typeof APP_EXACT_ROUTES)[number])) return true
  if (APP_PREFIX_ROOTS.includes(pathname as (typeof APP_PREFIX_ROOTS)[number])) return true
  return APP_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
