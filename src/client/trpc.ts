import {createTRPCClient, httpLink} from '@trpc/client'
import {createTRPCReact} from '@trpc/react-query'
import type {AppRouter} from '../server/trpc'

export const trpc = createTRPCReact<AppRouter>()

/** for direct client-side calls */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpLink({url: '/api/trpc'})],
})
