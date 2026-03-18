import {
  APP_EXACT_ROUTES,
  APP_ROUTE_PREFIXES,
  ARTIFACT_ROUTE_PREFIX,
  isAppRoute,
  isArtifactRoute,
} from '@artifact/config/routes'

export type RouteTarget = 'artifact' | 'app' | 'docs'

export const routeRequest = (pathname: string): RouteTarget => {
  if (isArtifactRoute(pathname)) return 'artifact'
  if (isAppRoute(pathname)) return 'app'
  return 'docs'
}

export const routeManifest = {
  artifactRoutePrefix: ARTIFACT_ROUTE_PREFIX,
  appExactRoutes: [...APP_EXACT_ROUTES],
  appRoutePrefixes: [...APP_ROUTE_PREFIXES],
} as const
