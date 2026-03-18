// @ts-nocheck
import {createServerFn} from '@tanstack/react-start'
import {getRequestHeaders} from '@tanstack/react-start/server'
import {redirect} from '@tanstack/react-router'
import {createServerAuth} from './server-auth'

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

export const getCurrentSession = createServerFn({method: 'GET'}).handler(async () => {
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
