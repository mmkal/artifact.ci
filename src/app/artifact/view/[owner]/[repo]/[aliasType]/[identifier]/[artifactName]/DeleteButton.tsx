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
  const mutation = trpc.deleteArtifact.useMutation()
  return (
    <button className={params.className} onClick={() => mutation.mutate(params)}>
      Delete
    </button>
  )
}
