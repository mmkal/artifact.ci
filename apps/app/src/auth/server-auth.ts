import {Pool} from 'pg'
import {betterAuth} from 'better-auth'
import {tanstackStartCookies} from 'better-auth/tanstack-start'

const globalPool = globalThis as typeof globalThis & {__artifactBetterAuthPool?: Pool}

const getConnectionString = () => {
  return process.env.DATABASE_URL || process.env.PGKIT_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5500/postgres'
}

const getPool = () => {
  globalPool.__artifactBetterAuthPool ??= new Pool({
    connectionString: getConnectionString(),
  })

  return globalPool.__artifactBetterAuthPool
}

export const createServerAuth = () => {
  return betterAuth({
    appName: 'artifact.ci',
    baseURL: process.env.BETTER_AUTH_URL || process.env.AUTH_URL || 'http://localhost:3000',
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET || 'dev-only-not-for-production',
    database: getPool(),
    trustedOrigins: ['http://localhost:3000', 'https://artifact.ci'],
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
    plugins: [tanstackStartCookies()],
  })
}

export type ServerAuth = ReturnType<typeof createServerAuth>
