'use client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {httpBatchLink, unstable_httpSubscriptionLink, loggerLink, splitLink} from '@trpc/client'
import {SessionProvider} from 'next-auth/react'
import React from 'react'
import {ReactNode} from 'react'
import {useState} from 'react'
import {trpc} from '../../../client/trpc'

function getUrl() {
  return '/api/trpc'
}

export default function Layout({children}: {children: ReactNode}) {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink(),
        splitLink({
          condition: op => op.type === 'subscription',
          true: unstable_httpSubscriptionLink({url: getUrl()}),
          false: httpBatchLink({url: getUrl()}),
        }),
      ],
    }),
  )

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  )
}
