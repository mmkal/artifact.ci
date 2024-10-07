import {NextRequest} from 'next/server'
import NextAuth, {type DefaultSession} from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'
import {App, Octokit} from 'octokit'
import {z} from 'zod'

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
      if (token.github_login) {
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

// export const getGithubAccessToken = async (request: NextRequest) => {
//   const cookieToken = request?.cookies.get('gh_token')?.value
//   if (cookieToken) return cookieToken

//   const session = await auth()
//   return session?.user.access_token
// }

export const getOctokitApp = () => {
  const env = GithubAppEnv.parse(process.env)
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  })
}

export const getInstallationOctokit = async (installationId: number) => {
  const app = getOctokitApp()
  return app.getInstallationOctokit(installationId)
}

export const getCollaborationLevel = async (
  octokit: Octokit,
  repo: {owner: string; repo: string},
  username: string,
) => {
  if (username === repo.owner) return 'admin'
  const {data: collaboration} = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner: repo.owner,
    repo: repo.repo,
    username,
  })
  const {permission} = z.object({permission: z.enum(['none', 'read', 'write', 'admin'])}).parse(collaboration)
  return permission
}
