import {
  APP_EXACT_ROUTES,
  APP_ROUTE_PREFIXES,
  ARTIFACT_BLOB_ROUTE_PREFIX,
  isAppRoute,
  isArtifactBlobRoute,
} from '@artifact/config/routes'

export type RouteTarget = 'artifact' | 'app' | 'docs'

export const routeRequest = (pathname: string): RouteTarget => {
  // Only blob-serving goes to the dedicated artifact worker; /artifact/view/*
  // renders in the app for parity with main.
  if (isArtifactBlobRoute(pathname)) return 'artifact'
  if (isAppRoute(pathname)) return 'app'
  return 'docs'
}

export const routeManifest = {
  artifactBlobRoutePrefix: ARTIFACT_BLOB_ROUTE_PREFIX,
  appExactRoutes: [...APP_EXACT_ROUTES],
  appRoutePrefixes: [...APP_ROUTE_PREFIXES],
} as const
