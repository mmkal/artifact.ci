import {betterAuth} from 'better-auth'
import {tanstackStartCookies} from 'better-auth/tanstack-start'
import {getAppEnv} from '../cloudflare-env'

const currentEnv = () => {
  try {
    return getAppEnv()
  } catch (error) {
    if (process.env.BETTER_AUTH_SCHEMA_GENERATE === '1') return null
    throw error
  }
}

const envValue = (name: keyof ReturnType<typeof getAppEnv>) => {
  const env = currentEnv() as unknown as Record<string, string> | null
  return (env && env[name]) || process.env[name] || ''
}

const authDatabase = () => {
  const env = currentEnv()
  return env?.ARTIFACT_DB
}

const getBaseUrl = () => {
  // Prefer an explicit BETTER_AUTH_URL (prod deploys / tests), then the
  // live PUBLIC_DEV_URL the dev script sets from the cloudflared tunnel,
  // then the legacy next-auth AUTH_URL (only useful if the user hasn't
  // run `pnpm dev` and still has an old value lying around), then the
  // localhost fallback.
  return envValue('BETTER_AUTH_URL') || envValue('PUBLIC_DEV_URL') || envValue('AUTH_URL') || 'http://localhost:3000'
}

const getTrustedOrigins = () => {
  const extras = [envValue('PUBLIC_DEV_URL'), envValue('BETTER_AUTH_URL'), envValue('AUTH_URL')].filter(Boolean)
  return Array.from(
    new Set(['http://localhost:3000', 'http://artifactci.localhost:1355', 'https://artifact.ci', ...extras]),
  )
}

export const createServerAuth = () => {
  return betterAuth({
    appName: 'artifact.ci',
    baseURL: getBaseUrl(),
    basePath: '/api/auth',
    secret: envValue('BETTER_AUTH_SECRET') || 'dev-only-not-for-production',
    database: authDatabase(),
    trustedOrigins: getTrustedOrigins(),
    user: {
      additionalFields: {
        githubLogin: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    socialProviders:
      envValue('GITHUB_APP_CLIENT_ID') && envValue('GITHUB_APP_CLIENT_SECRET')
        ? {
            github: {
              clientId: envValue('GITHUB_APP_CLIENT_ID'),
              clientSecret: envValue('GITHUB_APP_CLIENT_SECRET'),
              mapProfileToUser: profile => ({
                githubLogin: typeof profile.login === 'string' ? profile.login : undefined,
              }),
              // GitHub Apps don't respect OAuth email scope unless their User
              // permission "Email addresses: Read" is granted, and even then
              // users with "Keep my email addresses private" return no
              // public email. Fall back to GitHub's own noreply format
              // ({id}+{login}@users.noreply.github.com) so Better Auth's
              // email_not_found gate doesn't reject signup.
              getUserInfo: async token => {
                const headers = {
                  Authorization: `Bearer ${token.accessToken}`,
                  'User-Agent': 'artifact-ci',
                  Accept: 'application/vnd.github+json',
                }
                const profileRes = await fetch('https://api.github.com/user', {headers})
                if (!profileRes.ok) return null
                const profile: Record<string, unknown> = await profileRes.json()

                let email = typeof profile.email === 'string' ? profile.email : ''
                let emailVerified = false
                const emailsRes = await fetch('https://api.github.com/user/emails', {headers})
                if (emailsRes.ok) {
                  const emails = (await emailsRes.json()) as Array<{email: string; primary: boolean; verified: boolean}>
                  const primary = emails.find(e => e.primary) ?? emails[0]
                  if (primary) {
                    email ||= primary.email
                    emailVerified = primary.verified
                  }
                }
                if (!email && profile.id && profile.login) {
                  email = `${profile.id}+${profile.login}@users.noreply.github.com`
                }

                return {
                  user: {
                    id: String(profile.id),
                    name: (profile.name as string) || (profile.login as string),
                    email,
                    image: profile.avatar_url as string | undefined,
                    emailVerified,
                    githubLogin: typeof profile.login === 'string' ? profile.login : undefined,
                  },
                  data: profile,
                }
              },
            },
          }
        : {},
    plugins: [tanstackStartCookies()],
  })
}

export type ServerAuth = ReturnType<typeof createServerAuth>
