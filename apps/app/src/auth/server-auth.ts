import {Pool} from 'pg'
import {betterAuth} from 'better-auth'
import {admin} from 'better-auth/plugins'
import {tanstackStartCookies} from 'better-auth/tanstack-start'

const globalPool = globalThis as typeof globalThis & {__artifactBetterAuthPool?: Pool}

const getConnectionString = () => {
  return process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5500/postgres'
}

export const getPool = () => {
  globalPool.__artifactBetterAuthPool ??= new Pool({
    connectionString: getConnectionString(),
    // Aggressive lifecycle settings so workerd's shaky tcp doesn't leave us
    // holding a dead connection between requests.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  })

  return globalPool.__artifactBetterAuthPool
}

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
          },
        }
      : {},
    plugins: [tanstackStartCookies(), admin()],
  })
}

export type ServerAuth = ReturnType<typeof createServerAuth>
