import {z} from 'zod'

export const AliasType = z.enum(['run', 'sha', 'branch'])
export type AliasType = z.infer<typeof AliasType>
export const UploadRequest = z.object({
  owner: z.string(),
  repo: z.string(),
  job: z.object({
    head_sha: z.string(),
    head_branch: z.string(),
    run_id: z.number().int(),
    run_attempt: z.number().int(),
  }),
  artifact: z.object({
    id: z.number().int(),
    visibility: z.enum(['private', 'public']).optional(),
    aliasTypes: z.array(AliasType).min(1),
  }),
})
export type UploadRequest = z.infer<typeof UploadRequest>

export const UploadResponse = z.object({
  success: z.literal(true),
  urls: z.array(z.object({aliasType: z.string(), url: z.string()})),
})
export type UploadResponse = z.infer<typeof UploadResponse>
