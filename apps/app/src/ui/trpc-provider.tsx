import {QueryClientProvider} from '@tanstack/react-query'
import {useState, type ReactNode} from 'react'
import {createQueryClient, createTrpcClient, trpc} from '../trpc/client'

export function TrpcProvider({children}: {children: ReactNode}) {
  const [queryClient] = useState(() => createQueryClient())
  const [trpcClient] = useState(() => createTrpcClient())

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}
