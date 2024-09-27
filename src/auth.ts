import {NextRequest} from 'next/server'
import NextAuth from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'

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

export interface AugmentedSession {
  jwt_access_token: string | null
  token_note: string | null
}

// todo: github app auth
export const {handlers, signIn, signOut, auth} = NextAuth({
  providers: [Github],
  callbacks: {
    async jwt({token, account}) {
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
      return Object.assign(session, {
        jwt_access_token: (token.account_access_token as string) || null,
        token_note: token.note as string | null,
      } satisfies AugmentedSession)
    },
  },
})

export const getGithubAccessToken = async (request: NextRequest) => {
  const cookieToken = request?.cookies.get('gh_token')?.value
  if (cookieToken) return cookieToken

  const session = await auth()
  return (session as {} as AugmentedSession)?.jwt_access_token
}
