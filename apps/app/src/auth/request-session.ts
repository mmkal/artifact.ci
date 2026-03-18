import {createServerAuth} from './server-auth'

export interface RequestSessionSnapshot {
  githubLogin?: string
}

export const getRequestSession = async (request: Request): Promise<RequestSessionSnapshot> => {
  const auth = createServerAuth()
  const session = await auth.api.getSession({headers: request.headers})
  const githubLogin = session?.user && 'githubLogin' in session.user ? (session.user.githubLogin as string | null) : null
  return {githubLogin: githubLogin || undefined}
}
