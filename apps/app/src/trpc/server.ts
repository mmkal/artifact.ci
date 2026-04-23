import {fetchRequestHandler} from '@trpc/server/adapters/fetch'
import {createServerAuth} from '../auth/server-auth'
import {appRouter} from './router'

export async function handleTrpcRequest(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: async ({req}) => {
      const auth = createServerAuth()
      const session = await auth.api.getSession({headers: req.headers}).catch(() => null)
      const githubLogin = session?.user && 'githubLogin' in session.user
        ? (session.user as {githubLogin?: string | null}).githubLogin
        : null
      return {
        githubLogin,
        getHeader: (name: string) => req.headers.get(name),
      }
    },
  })
}
