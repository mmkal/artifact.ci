import {
  PathParams as ArtifactPathParamsSchema,
  toBreadcrumbs,
  toPath,
  type PathParams as ArtifactPathParams,
} from '@artifact/domain/artifact/path-params'
import {globalServerOrigin} from '~/analytics/origin.server'

export const PathParams = ArtifactPathParamsSchema
export {toBreadcrumbs, toPath}
export type PathParams = ArtifactPathParams

export const toFullUrl = (params: Partial<ArtifactPathParams>, searchParams?: {}) => {
  return `${globalServerOrigin()}${toPath(params)}?${new URLSearchParams(searchParams)}`.replace(/[/?]+$/, '')
}
