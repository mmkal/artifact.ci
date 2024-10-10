import {z} from 'zod'
import {globalServerOrigin} from '~/analytics/origin.server'

export const PathParams = z.object({
  owner: z.string(),
  repo: z.string(),
  aliasType: z.string(),
  identifier: z.string(),
  artifactName: z.string(),
  filepath: z.array(z.string()).optional(),
})
export type PathParams = z.infer<typeof PathParams>

export const toBreadcrumbs = (params: Partial<PathParams>) => {
  const breadcrumbs = [{label: 'Artifacts', path: '/artifact/view', template: `/artifact/view`}]
  Object.keys(PathParams.shape).flatMap(key => {
    const value = params[key as keyof PathParams]
    if (!value) return []
    const previous = breadcrumbs.at(-1)!
    const valueString = [value].flat().join('/')
    const segment = Array.isArray(value) ? `[${key}]` : key
    breadcrumbs.push({
      label: valueString,
      path: `${previous.path}/${valueString}`,
      template: `${previous.template}/${segment}`,
    })
  })
  return breadcrumbs
}

export const toPath = (params: Partial<PathParams>) => {
  return toBreadcrumbs(params).at(-1)!.path
}

export const toFullUrl = (params: Partial<PathParams>) => {
  return `${globalServerOrigin()}${toPath(params)}`
}
