import {z} from 'zod'

export const WorkflowJobCompleted = z.object({
  action: z.enum(['completed']),
  installation: z.object({
    id: z.number(),
  }),
  workflow_job: z.object({
    id: z.number(),
    run_id: z.number(),
    workflow_name: z.string(),
    head_branch: z.string(),
    head_sha: z.string(),
    run_attempt: z.number(),
    status: z.string(),
    conclusion: z.string(),
    name: z.string().brand('WorkflowJobName'),
  }),
  repository: z.object({
    full_name: z.string(),
  }),
})
export type WorkflowJobCompleted = z.infer<typeof WorkflowJobCompleted>

export const WorkflowJobNotCompleted = z.object({
  action: z.enum(['queued', 'waiting', 'in_progress']),
  workflow_job: z.object({}),
})

export const InstallationAdded = z.object({
  action: z.enum(['added']),
  installation: z.object({
    id: z.number(),
    repositories_added: z.array(z.object({full_name: z.string()})),
  }),
})
export type InstallationAdded = z.infer<typeof InstallationAdded>

export const InstallationRemoved = z.object({
  action: z.enum(['removed']),
  installation: z.object({
    id: z.number(),
    repositories_removed: z.array(z.object({full_name: z.string()})),
  }),
})
export type InstallationRemoved = z.infer<typeof InstallationRemoved>

export const AppWebhookEvent = z.union([
  WorkflowJobCompleted.transform(data => ({
    ...data,
    eventType: 'workflow_job_completed' as const,
  })),
  WorkflowJobNotCompleted.transform(data => ({
    ...data,
    eventType: 'workflow_job_not_completed' as const,
  })),
  InstallationAdded.transform(data => ({
    ...data,
    eventType: 'installation_added' as const,
  })),
  InstallationRemoved.transform(data => ({
    ...data,
    eventType: 'installation_removed' as const,
  })),
  z.object({action: z.string(), worfklow_job: z.undefined().optional()}).transform(data => ({
    ...data,
    eventType: 'unknown_action' as const,
  })),
])
export type AppWebhookEvent = z.infer<typeof AppWebhookEvent>
