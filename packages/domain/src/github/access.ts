import {type Octokit} from 'octokit'
import {type AsyncClient} from 'sqlfu'
import {z} from 'zod'
import {captureServerEvent} from '../analytics/posthog-server'
import {createPrefixedId, type Id} from '../db/client'
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
export type CheckCanAccessOptions = {db: AsyncClient}

export const checkCreditStatus = async (params: CheckCreditStatusParams, options: CheckCanAccessOptions) => {
  const githubLogin = params.username ? params.username.toLowerCase() : null
  const ownerLogin = params.owner.toLowerCase()
  const now = new Date().toISOString()
  const credits = await options.db.sql.all<queries.Credit>`
    select sponsor_id, reason, artifact_id, artifact_name, visibility
    from (
      select
        uc.sponsor_id,
        uc.reason,
        a.id as artifact_id,
        a.name as artifact_name,
        a.visibility
      from usage_credits uc
      left join artifacts a on a.id = ${params.artifactId}
      where ((${githubLogin} is not null and uc.github_login = ${githubLogin}) or uc.github_login = ${ownerLogin})
        and uc.expiry > ${now}
      union all
      select
        null as sponsor_id,
        'artifact visibility: ' || a.visibility as reason,
        a.id as artifact_id,
        a.name as artifact_name,
        a.visibility
      from artifacts a
      where a.id = ${params.artifactId}
        and a.visibility = 'public'
    )
  `
    if (credits.length > 1) logger.warn('checkCanAccess: multiple credits', {credits, params})

    if (credits.length === 0) {
      let freeTrial: queries.FreeTrial | null = null
      if (githubLogin) {
        const priorRows = await options.db.sql.all<{prior_free_trial_count: number}>`
          select count(*) as prior_free_trial_count
          from usage_credits
          where github_login = ${githubLogin}
            and expiry < ${now}
            and reason = 'free_trial'
        `
        const priorFreeTrialCount = Number(priorRows[0]?.prior_free_trial_count || 0)
        if (priorFreeTrialCount < 10) {
          const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          const rows = await options.db.sql.all<Omit<queries.FreeTrial, 'prior_free_trial_count'>>`
            insert into usage_credits (id, github_login, reason, expiry)
            values (${createPrefixedId('usage_credit')}, ${githubLogin}, 'free_trial', ${expiry})
            returning id, github_login, expiry, sponsor_id, reason, created_at, updated_at
          `
          if (rows[0]) freeTrial = {...rows[0], prior_free_trial_count: priorFreeTrialCount}
        }
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
}

export const checkCanAccess = async (octokit: Octokit, params: CheckCreditStatusParams, options: CheckCanAccessOptions) => {
  const creditStatus = await checkCreditStatus(params, options)
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
  export interface Credit extends Record<string, unknown> {
    sponsor_id: string | null
    reason: string | null
    artifact_id: Id<'artifacts'> | null
    artifact_name: string | null
    visibility: string | null
  }

  export interface FreeTrial {
    id: Id<'new_free_trial_credit'>
    github_login: string
    expiry: string
    sponsor_id: string | null
    reason: string
    created_at: string
    updated_at: string
    prior_free_trial_count: number
  }
}
