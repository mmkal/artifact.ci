import {Client} from 'pg'
import {betterAuth} from 'better-auth'
import {tanstackStartCookies} from 'better-auth/tanstack-start'

const getConnectionString = () => {
  return process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5500/postgres'
}

// Minimal pg.Pool shim for Better Auth. better-auth detects
// `"connect" in db` and hands the object to Kysely as
// `new PostgresDialect({pool: db})`. Kysely calls pool.connect() to
// get a client, runs queries on it, then calls client.release() to
// return it. With a real pg.Pool this hangs after a few queries in
// workerd (same shape as the upload/events hang we already fixed),
// so we hand out a brand-new Client per connect() and end() it on
// release(). Aggressive, but reliable through miniflare.
const connectFreshClient = async () => {
  const client = new Client({connectionString: getConnectionString()})
  await client.connect()
  return Object.assign(client, {
    release: async () => {
      await client.end().catch(() => {})
    },
  })
}

const freshPerConnectPool = {
  connect: connectFreshClient,
  // Kysely's PostgresDriver only calls these when it's shutting the pool
  // down (which better-auth never does in a request lifecycle). Stubs
  // here so the surface matches pg.Pool closely enough.
  end: async () => {},
  on: () => {},
  off: () => {},
}

export const getPool = () => freshPerConnectPool

const getBaseUrl = () => {
  // Prefer an explicit BETTER_AUTH_URL (prod deploys / tests), then the
  // live PUBLIC_DEV_URL the dev script sets from the cloudflared tunnel,
  // then the legacy next-auth AUTH_URL (only useful if the user hasn't
  // run `pnpm dev` and still has an old value lying around), then the
  // localhost fallback.
  return (
    process.env.BETTER_AUTH_URL ||
    process.env.PUBLIC_DEV_URL ||
    process.env.AUTH_URL ||
    'http://localhost:3000'
  )
}

const getTrustedOrigins = () => {
  const extras = [process.env.PUBLIC_DEV_URL, process.env.BETTER_AUTH_URL, process.env.AUTH_URL]
    .filter((u): u is string => Boolean(u))
  return Array.from(new Set(['http://localhost:3000', 'http://artifactci.localhost:1355', 'https://artifact.ci', ...extras]))
}

export const createServerAuth = () => {
  return betterAuth({
    appName: 'artifact.ci',
    baseURL: getBaseUrl(),
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET || 'dev-only-not-for-production',
    database: getPool(),
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
    socialProviders: process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_APP_CLIENT_ID,
            clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
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
