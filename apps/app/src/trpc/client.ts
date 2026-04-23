import {createTRPCReact, httpBatchLink, loggerLink} from '@trpc/react-query'
import {QueryClient} from '@tanstack/react-query'
import type {AppRouter} from './router'

export const trpc = createTRPCReact<AppRouter>()

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {queries: {staleTime: 30_000, refetchOnWindowFocus: false}},
  })
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      loggerLink({enabled: op => op.direction === 'down' && op.result instanceof Error}),
      httpBatchLink({url: '/api/trpc'}),
    ],
  })
}
