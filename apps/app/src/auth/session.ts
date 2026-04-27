// @ts-nocheck
import {createServerFn} from '@tanstack/react-start'
import {redirect} from '@tanstack/react-router'

export interface AppViewer {
  id: string
  name: string | null | undefined
  email: string | null | undefined
  image: string | null | undefined
  githubLogin: string | null | undefined
}

export interface AppSessionSnapshot {
  user: AppViewer | null
}

// The handlers are server-only. Dynamic-import anything that pulls in pg /
// better-auth / request-headers APIs so the module can still be imported
// from client components (TanStack Start RPC-ifies .handler() at build time,
// but eager top-level imports land in the client bundle and break with
// "process is not defined").
export const getCurrentSession = createServerFn({method: 'GET'}).handler(async () => {
  const [{createServerAuth}, {getRequestHeaders}] = await Promise.all([
    import('./server-auth'),
    import('@tanstack/react-start/server'),
  ])
  const auth = createServerAuth()
  const session = await auth.api.getSession({headers: getRequestHeaders()})

  if (!session?.user) {
    return {user: null} satisfies AppSessionSnapshot
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      githubLogin: 'githubLogin' in session.user ? (session.user.githubLogin as string | null | undefined) : undefined,
    },
  } satisfies AppSessionSnapshot
})

export const requireCurrentSession = createServerFn({method: 'GET'})
  .inputValidator((input: {redirectTo: string}) => input)
  .handler(async ({data}) => {
    const session = await getCurrentSession()

    if (!session.user) {
      throw redirect({
        to: '/login',
        search: {callbackUrl: data.redirectTo},
      })
    }

    return session
  })
