import {createRouter} from '@tanstack/react-router'
import {type AppSessionSnapshot} from './auth/session'
import {routeTree} from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    context: {
      session: {user: null} satisfies AppSessionSnapshot,
    },
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
