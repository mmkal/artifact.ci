import {Webhooks} from '@octokit/webhooks'
import {NextRequest} from 'next/server'
import NextAuth, {type DefaultSession} from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'
import {App, Octokit} from 'octokit'
import {z} from 'zod'
import {captureServerEvent} from './analytics/posthog-server'
import {client, sql} from './db'
import {logger} from './tag-logger'

declare module 'next-auth' {
  /** Augmented - see https://authjs.dev/getting-started/typescript */
  interface Session {
    user: {
      github_login: string | null
    } & DefaultSession['user']
  }
}

export const GithubAppClientEnv = z.object({
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
})

export const GithubAppEnv = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
})

export const WebhookEnv = z.object({
  GITHUB_APP_WEBHOOK_SECRET: z.string(),
})

const Github: typeof DefaultGithub = options => {
  const env = GithubAppClientEnv.parse(process.env)
  return DefaultGithub({
    ...options,
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  })
}

export const {handlers, signIn, signOut, auth} = NextAuth({
  providers: [Github],
  callbacks: {
    async jwt({token, account}) {
      if (token.github_login && typeof token.github_login === 'string') {
        token.github_login_note = `jwt callback: github_login already set`
      } else if (account) {
        const octokit = new Octokit({auth: account.access_token})
        const {data: user} = await octokit.rest.users.getAuthenticated()
        token.github_login = user.login
        token.github_login_note = `jwt callback: added github_login`
      } else {
        token.github_login_note = `jwt callback: no account`
      }

      return token
    },
    async session({session, token}) {
      // typically session.user looks like {name: 'A B', email: undefined, image: 'https://.../something.jpg'}
      // typically token looks like {name: 'A B', picture: 'https://.../something.jpg', email: 'a@b.com', ...}
      session.user.github_login = token.github_login as string | null
      return session
    },
  },
})

export const getOctokitApp = () => {
  const env = GithubAppEnv.parse(process.env)
  return new App({appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY})
}

export const getInstallationOctokit = async (installationId: number) => {
  const app = getOctokitApp()
  return app.getInstallationOctokit(installationId)
}

export type GetCollaborationLevelParams = {owner: string; repo: string; username: string}
export const getCollaborationLevel = async (octokit: Octokit, params: GetCollaborationLevelParams) => {
  if (params.username === params.owner) return 'admin'
  const {data: collaboration} = await octokit.rest.repos.getCollaboratorPermissionLevel(params)
  const parsed = z.object({permission: z.enum(['none', 'read', 'write', 'admin'])}).safeParse(collaboration)
  if (!parsed.success) logger.error({collaboration}, 'getCollaborationLevel: failed to parse collaboration')
  return parsed.success ? parsed.data.permission : 'none'
}

export type CheckCreditStatusParams = GetCollaborationLevelParams & {artifactId: string}
export const checkCreditStatus = async (params: CheckCreditStatusParams) => {
  // todo: pgkit: the type isn't quite right. it's a full outer join so everything should be nullable
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
      (github_login = ${params.username.toLowerCase()} or github_login = ${params.owner.toLowerCase()})
      and expiry > now()
  `)
  if (credits.length > 1) logger.warn({credits, params}, 'checkCanAccess: multiple credits')

  if (credits.length === 0) {
    const freeTrial = await client.maybeOne(sql<queries.FreeTrial>`
      with prior_free_trial_credits as (
        select count(*) as prior_free_trial_count
        from usage_credits
        where github_login = ${params.username.toLowerCase()}
        and expiry < now()
        and reason = 'free_trial'
      ),
      new_free_trial_credit as (
        insert into usage_credits (github_login, reason, expiry)
        select ${params.username.toLowerCase()}, 'free_trial', now() + interval '24 hours'
        from prior_free_trial_credits
        where prior_free_trial_count < 5
        returning *
      )
      select * from new_free_trial_credit
      join prior_free_trial_credits on true
    `)
    logger.warn({freeTrial}, 'checkCanAccess: free trial credits')
    if (freeTrial) {
      captureServerEvent({
        distinctId: params.username,
        event: 'free_trial_credit_created',
        properties: {
          artifact_id: params.artifactId,
          expiry: freeTrial.expiry,
          count: freeTrial.prior_free_trial_count + 1,
        },
      })
      return {
        result: true,
        reason: `created free trial credit: ${freeTrial.reason} (#${freeTrial.prior_free_trial_count + 1})`,
      } as const
    }
    return {result: false, reason: 'no credit'} as const
  }

  return {result: true, reason: credits.map(c => c.reason).join(';')} as const
}

export const checkCanAccess = async (octokit: Octokit, params: CheckCreditStatusParams) => {
  const creditStatus = await checkCreditStatus(params)
  if (!creditStatus.result) return creditStatus

  const level = await getCollaborationLevel(octokit, params)
  if (level === 'none') {
    return {result: false, reason: `github access level: ${level}`} as const
  }

  return {result: true, reason: `credit status: ${creditStatus.reason}. github access level: ${level}`} as const
}

/** Returns the JSON body of a GitHub webhook payload if the signature is valid, null otherwise. */
export const validateGithubWebhook = async (request: NextRequest, json?: string) => {
  json ??= await request.clone().text()
  const webhookEnv = WebhookEnv.parse(process.env)
  const webhooks = new Webhooks({secret: webhookEnv.GITHUB_APP_WEBHOOK_SECRET})
  const signature = request.headers.get('x-hub-signature-256') || ''
  logger.debug('validating webhook', {signature, secretLength: webhookEnv.GITHUB_APP_WEBHOOK_SECRET.length})
  return webhooks.verify(json, signature)
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select sponsor_id, coalesce(reason, 'art... [truncated] ... or github_login = $3 and expiry > now()` */
  export interface Credit {
    /** column: `public.usage_credits.sponsor_id`, regtype: `prefixed_ksuid` */
    sponsor_id: string | null

    /** regtype: `text` */
    reason: string | null

    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    artifact_id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.name`, not null: `true`, regtype: `text` */
    artifact_name: string

    /** column: `public.artifacts.visibility`, not null: `true`, regtype: `text` */
    visibility: string
  }

  /** - query: `with prior_free_trial_credits as ( selec... [truncated] ...it join prior_free_trial_credits on true` */
  export interface FreeTrial {
    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.id
     *
     * column: `✨.new_free_trial_credit.id`, not null: `true`, regtype: `prefixed_ksuid`
     */
    id: import('~/db').Id<'new_free_trial_credit'>

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.github_login
     *
     * column: `✨.new_free_trial_credit.github_login`, not null: `true`, regtype: `text`
     */
    github_login: string

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.expiry
     *
     * column: `✨.new_free_trial_credit.expiry`, not null: `true`, regtype: `timestamp with time zone`
     */
    expiry: Date

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.sponsor_id
     *
     * column: `✨.new_free_trial_credit.sponsor_id`, regtype: `prefixed_ksuid`
     */
    sponsor_id: string | null

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.reason
     *
     * column: `✨.new_free_trial_credit.reason`, not null: `true`, regtype: `text`
     */
    reason: string

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.created_at
     *
     * column: `✨.new_free_trial_credit.created_at`, not null: `true`, regtype: `timestamp with time zone`
     */
    created_at: Date

    /**
     * From CTE subquery "new_free_trial_credit", column source: public.usage_credits.updated_at
     *
     * column: `✨.new_free_trial_credit.updated_at`, not null: `true`, regtype: `timestamp with time zone`
     */
    updated_at: Date

    /**
     * From CTE subquery "prior_free_trial_credits"
     *
     * column: `✨.prior_free_trial_credits.prior_free_trial_count`, not null: `true`, regtype: `bigint`
     */
    prior_free_trial_count: number
  }
}
