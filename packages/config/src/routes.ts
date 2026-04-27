// Blob-serving lives on the frontdoor worker so it can stream from Supabase
// Storage without bouncing through the app. Everything else under /artifact/
// (notably /artifact/view/*, matching main's URL shape) renders in the app.
export const ARTIFACT_BLOB_ROUTE_PREFIX = '/artifact/blob/'
export const ARTIFACT_VIEW_ROUTE_PREFIX = '/artifact/view/'
/** @deprecated retained so old /artifact/view/... links continue to resolve */
export const LEGACY_ARTIFACT_VIEW_PREFIX = ARTIFACT_VIEW_ROUTE_PREFIX

export const APP_EXACT_ROUTES = ['/login', '/account', '/artifact/view'] as const

export const APP_ROUTE_PREFIXES = [
  '/app/',
  '/api/',
  '/github/',
  ARTIFACT_VIEW_ROUTE_PREFIX,
  // TanStack Start prod outputs reference these directly from the
  // generated HTML — route them to the app Worker, which has the
  // ASSETS binding pointing at apps/app/dist/client and serves
  // /_serverFn/* via createServerFn.
  '/assets/',
  '/_serverFn/',
] as const
export const APP_PREFIX_ROOTS = ['/app', '/api'] as const

export const isArtifactBlobRoute = (pathname: string) => pathname.startsWith(ARTIFACT_BLOB_ROUTE_PREFIX)

export const isAppRoute = (pathname: string) => {
  if (APP_EXACT_ROUTES.includes(pathname as (typeof APP_EXACT_ROUTES)[number])) return true
  if (APP_PREFIX_ROOTS.includes(pathname as (typeof APP_PREFIX_ROOTS)[number])) return true
  return APP_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
