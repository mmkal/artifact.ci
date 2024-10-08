'use client'

import {TrpcProvider} from './TrpcProvider'
import {trpc} from '~/client/trpc'

export const DeleteButton = (params: {artifactId: string; className?: string}) => {
  return (
    <TrpcProvider>
      <DeleteButtonInner {...params} />
    </TrpcProvider>
  )
}

function DeleteButtonInner(params: {artifactId: string; className?: string}) {
  const mutation = trpc.deleteEntries.useMutation({
    onSuccess: () => (window.location.href = window.location.pathname + `?reload=true`),
  })
  return (
    <button disabled={!mutation.isIdle} className={params.className} onClick={() => mutation.mutate(params)}>
      Delete
    </button>
  )
}
