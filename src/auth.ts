import {NextRequest} from 'next/server'
import NextAuth, {type DefaultSession} from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'
import {Octokit} from 'octokit'

declare module 'next-auth' {
  /** Augmented - see https://authjs.dev/getting-started/typescript */
  interface Session {
    user: {
      github_login: string | null
      access_token: string | null
    } & DefaultSession['user']
  }
}

const Github: typeof DefaultGithub = options => {
  const base = DefaultGithub({
    ...options,
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
  })
  return {
    ...base,
    authorization: {
      ...(base.authorization as {}),
      params: {
        ...(base.authorization as {params: {scope: string}})?.params,
        scope: 'repo read:user user:email', // seems scope is hardcoded in next-auth to read:user user:email
      },
    },
  }
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

      // todo: hopefully, this can be removed. the only reason it might be needed is to allow downloading artifacts on the client, but maybe that's a bad idea anyway.
      if (token.account_access_token) {
        token.note = `jwt callback: account_access_token already set`
      } else if (account) {
        token.account_access_token = account.access_token
        token.note = `jwt callback: added account_access_token`
      } else {
        token.note = `jwt callback: didn't add account_access_token`
      }

      return token
    },
    async session({session, token}) {
      // typically session.user looks like {name: 'A B', email: undefined, image: 'https://.../something.jpg'}
      // typically token looks like {name: 'A B', picture: 'https://.../something.jpg', email: 'a@b.com', ...}
      session.user.github_login = token.github_login as string | null
      session.user.access_token = token.account_access_token as string | null
      return session
    },
  },
})

export const getGithubAccessToken = async (request: NextRequest) => {
  const cookieToken = request?.cookies.get('gh_token')?.value
  if (cookieToken) return cookieToken

  const session = await auth()
  return session?.user.access_token
}
