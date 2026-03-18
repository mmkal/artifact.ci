import {type PathParams} from './path-params'

export interface ArtifactResolveRequest {
  params: PathParams
  requestPathname: string
  raw: boolean
}

export type ArtifactResolveResponse =
  | {
      kind: 'serve-file'
      storagePathname: string
      params: PathParams
      raw: boolean
    }
  | {
      kind: 'redirect'
      location: string
      status: 302 | 307 | 308
    }
  | {
      kind: 'json'
      status: number
      body: unknown
    }
