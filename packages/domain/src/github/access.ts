import {type Octokit} from 'octokit'
import {Client} from 'pg'
import {z} from 'zod'
import {captureServerEvent} from '../analytics/posthog-server'
import {type Id} from '../db/client'
import {logger} from '../logging/tag-logger'

async function withPg<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({connectionString: process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING})
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end().catch(() => {})
  }
}

export type GetCollaborationLevelParams = {owner: string; repo: string; username: string | undefined}

export const getCollaborationLevel = async (octokit: Octokit, params: GetCollaborationLevelParams) => {
  if (params.username === params.owner) return 'admin'
  if (!params.username) return 'none'
  const {data: collaboration} = await octokit.rest.repos.getCollaboratorPermissionLevel({...params, username: params.username})
  const parsed = z.object({permission: z.enum(['none', 'read', 'write', 'admin'])}).safeParse(collaboration)
  if (!parsed.success) logger.error({collaboration}, 'getCollaborationLevel: failed to parse collaboration')
  return parsed.success ? parsed.data.permission : 'none'
}

export type CheckCreditStatusParams = GetCollaborationLevelParams & {artifactId: string}

export const checkCreditStatus = async (params: CheckCreditStatusParams) => {
  const githubLogin = params.username?.toLowerCase() ?? null
  return withPg(async c => {
    const {rows: credits} = await c.query<queries.Credit>(
      `select
         sponsor_id,
         coalesce(reason, 'artifact visibility: ' || a.visibility) as reason,
         a.id as artifact_id,
         a.name as artifact_name,
         a.visibility
       from usage_credits
       full outer join artifacts a on a.id = $1 and a.visibility = 'public'
       where (github_login = $2 or github_login = $3) and expiry > now()`,
      [params.artifactId, githubLogin, params.owner.toLowerCase()],
    )
    if (credits.length > 1) logger.warn('checkCanAccess: multiple credits', {credits, params})

    if (credits.length === 0) {
      let freeTrial: queries.FreeTrial | null = null
      if (githubLogin) {
        const {rows} = await c.query<queries.FreeTrial>(
          `with prior_free_trial_credits as (
             select count(*) as prior_free_trial_count
             from usage_credits
             where github_login = $1
               and expiry < now()
               and reason = 'free_trial'
           ),
           new_free_trial_credit as (
             insert into usage_credits (github_login, reason, expiry)
             select $1, 'free_trial', now() + interval '24 hours'
             from prior_free_trial_credits
             where prior_free_trial_count < 10
             returning *
           )
           select *
           from new_free_trial_credit
           join prior_free_trial_credits on true`,
          [githubLogin],
        )
        freeTrial = rows[0] ?? null
      }
      logger.warn(`checkCanAccess: ${freeTrial?.prior_free_trial_count} prior free trial credits`, freeTrial)
      if (freeTrial) {
        captureServerEvent({
          distinctId: githubLogin || 'anonymous',
          event: 'free_trial_credit_created',
          properties: {
            artifact_id: params.artifactId,
            expiry: freeTrial.expiry,
            count: freeTrial.prior_free_trial_count + 1,
          },
        })
        return {
          canAccess: true,
          code: 'created_free_trial_credit',
          reason: `created free trial credit: ${freeTrial.reason} (#${freeTrial.prior_free_trial_count + 1})`,
        } as const
      }
      return {canAccess: false, code: 'no_credit', reason: 'no_credit'} as const
    }

    const isPublic = credits.some(c => c.visibility === 'public')
    return {canAccess: true, code: 'has_credit', reason: credits.map(c => c.reason).join(';'), isPublic} as const
  })
}

export const checkCanAccess = async (octokit: Octokit, params: CheckCreditStatusParams) => {
  const creditStatus = await checkCreditStatus(params)
  if (!creditStatus.canAccess) return creditStatus

  if (creditStatus.isPublic) return creditStatus

  const level = await getCollaborationLevel(octokit, params)
  if (level === 'none') {
    return {canAccess: false, code: 'no_github_access', reason: `github access level: ${level}`} as const
  }

  return {
    canAccess: true,
    code: 'can_access',
    reason: `credit status: ${creditStatus.reason}. github access level: ${level}`,
  } as const
}

export declare namespace queries {
  export interface Credit {
    sponsor_id: string | null
    reason: string | null
    artifact_id: Id<'artifacts'>
    artifact_name: string
    visibility: string
  }

  export interface FreeTrial {
    id: Id<'new_free_trial_credit'>
    github_login: string
    expiry: Date
    sponsor_id: string | null
    reason: string
    created_at: Date
    updated_at: Date
    prior_free_trial_count: number
  }
}
