import {NextRequest} from 'next/server'
import NextAuth from 'next-auth'
import DefaultGithub from 'next-auth/providers/github'

const Github: typeof DefaultGithub = options => {
  const base = DefaultGithub({
    ...options,
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
    async session({session, token}) {
      return Object.assign(session, {jwt_access_token: token.access_token as string})
    },
  },
})

export const getGithubAccessToken = async (request: NextRequest) => {
  const cookieToken = request?.cookies.get('gh_token')?.value
  if (cookieToken) return cookieToken

  const session = await auth()
  return (session as {jwt_access_token?: string} | null)?.jwt_access_token
}
