import {handlers} from '../../../../auth'

export const {GET, POST} = handlers
// import NextAuth, {AuthOptions, getServerSession as getNextAuthServerSession} from 'next-auth'
// import GithubProvider from 'next-auth/providers/github'

// declare module 'next-auth' {
//   interface DefaultSession {
//     jwt_access_token: string
//   }
// }

// export const authOptions = {
//   providers: [
//     GithubProvider({
//       clientId: process.env.GITHUB_OAUTH_CLIENT_ID!,
//       clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET!,
//       authorization: {params: {scope: 'repo'}},
//     }),
//   ],
//   callbacks: {
//     async jwt({token, account}) {
//       if (account) {
//         token.account_access_token = account.access_token
//       }
//       return token
//     },
//     async session({session, token}) {
//       session.jwt_access_token = token.account_access_token as string
//       return session
//     },
//   },
// } satisfies AuthOptions

// const handler = NextAuth(authOptions) as {}

// export {handler as GET, handler as POST}

// export const getServerSession = () => getNextAuthServerSession(authOptions)

// export const getSessionGithubToken = async () => {
//   const session = await getServerSession()
//   return session?.jwt_access_token
// }
