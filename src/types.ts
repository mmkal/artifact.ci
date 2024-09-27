import {HandleUploadBody} from '@vercel/blob/client'
import {z} from 'zod'
import {Id} from '~/db'

export const GithubActionsContext = z.object({
  ref: z.string(),
  sha: z.string(),
  runId: z.number().int(),
  runAttempt: z.number().int(),
  /** this is the job id - i.e. the key in the yaml definition, not the `name` property in the job object. */
  job: z.string(),
  repository: z.string().refine(s => s.split('/').length === 2, 'Repository should be in the format of owner/repo'),
  /** usually https://github.com */
  githubOrigin: z.string(),
  /** usually https://api.github.com */
  githubApiUrl: z.string(),
  githubRetentionDays: z.number().int().min(1).max(400),
})
export type GithubActionsContext = z.infer<typeof GithubActionsContext>

export const ClientPayload = z.object({
  githubToken: z.string().nullable(),
  context: GithubActionsContext,
})
export type ClientPayload = z.infer<typeof ClientPayload>

export type GenerateClientTokenEvent = Extract<HandleUploadBody, {type: 'blob.generate-client-token'}>

export const BulkRequestFile = z.object({
  localPath: z.string().refine(s => {
    if (s.startsWith('/')) return false
    if (/^[A-Za-z]:/.test(s)) return false // windows
    return true
  }, 'Local path should not be absolute'),
  multipart: z.boolean(),
})

export const BulkRequest = z.object({
  type: z.literal('bulk'),
  files: z.array(BulkRequestFile),
  callbackUrl: z.string(),
  clientPayload: ClientPayload,
})
export type BulkRequest = z.infer<typeof BulkRequest>

export const BulkResponseItem = z.object({
  localPath: z.string(),
  viewUrl: z.string().url(),
  pathname: z.string(),
  clientToken: z.string(),
  contentType: z.string(),
})
export type BulkResponseItem = z.infer<typeof BulkResponseItem>

export const BulkResponse = z.object({
  results: z.array(BulkResponseItem),
  entrypoints: z.array(z.string()),
})
export type BulkResponse = z.infer<typeof BulkResponse>

export const TokenPayload = z.object({
  uploadRequestId: Id('upload_requests'),
  retentionDays: z.number().int().min(1).max(400),
})
export type TokenPayload = z.infer<typeof TokenPayload>

export const tokenPayloadCodec = {
  parse: (text: string): TokenPayload => {
    return TokenPayload.parse(JSON.parse(text))
  },
  stringify: (value: TokenPayload): string => {
    return JSON.stringify(value)
  },
}
