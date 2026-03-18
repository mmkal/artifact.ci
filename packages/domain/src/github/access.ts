import {type Octokit} from 'octokit'
import {z} from 'zod'
import {captureServerEvent} from '../analytics/posthog-server'
import {client, sql, type Id} from '../db/client'
import {logger} from '../logging/tag-logger'

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
  const credits = await client.any(sql<queries.Credit>`
    select
      sponsor_id,
      coalesce(reason, 'artifact visibility: ' || a.visibility) as reason,
      a.id as artifact_id,
      a.name as artifact_name,
      a.visibility
    from usage_credits
    full outer join artifacts a on a.id = ${params.artifactId} and a.visibility = 'public'
    where
      (github_login = ${githubLogin} or github_login = ${params.owner.toLowerCase()})
      and expiry > now()
  `)
  if (credits.length > 1) logger.warn('checkCanAccess: multiple credits', {credits, params})

  if (credits.length === 0) {
    const freeTrial = githubLogin
      ? await client.maybeOne(sql<queries.FreeTrial>`
        with prior_free_trial_credits as (
          select count(*) as prior_free_trial_count
          from usage_credits
          where github_login = ${githubLogin}
          and expiry < now()
          and reason = 'free_trial'
        ),
        new_free_trial_credit as (
          insert into usage_credits (github_login, reason, expiry)
          select ${githubLogin}, 'free_trial', now() + interval '24 hours'
          from prior_free_trial_credits
          where prior_free_trial_count < 10
          returning *
        )
        select *
        from new_free_trial_credit
        join prior_free_trial_credits on true
      `)
      : null
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
