import {Webhooks} from '@octokit/webhooks'
import {NextRequest} from 'next/server'
import NextAuth, {type DefaultSession} from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'
import {App, Octokit} from 'octokit'
import {z} from 'zod'
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

export const getCollaborationLevel = async (
  octokit: Octokit,
  params: {owner: string; repo: string; username: string},
) => {
  if (params.username === params.owner) return 'admin'
  const {data: collaboration} = await octokit.rest.repos.getCollaboratorPermissionLevel(params)
  const parsed = z.object({permission: z.enum(['none', 'read', 'write', 'admin'])}).safeParse(collaboration)
  if (!parsed.success) logger.error({collaboration}, 'getCollaborationLevel: failed to parse collaboration')
  return parsed.success ? parsed.data.permission : 'none'
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
