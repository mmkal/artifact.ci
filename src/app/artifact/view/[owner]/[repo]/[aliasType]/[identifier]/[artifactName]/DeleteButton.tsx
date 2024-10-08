'use client'

import {TrpcProvider} from './TrpcProvider'
import {trpc} from '~/client/trpc'

export declare namespace DeleteButton {
  export type Props = {artifactId: string; className?: string; children?: React.ReactNode}
}
export const DeleteButton = (props: DeleteButton.Props) => {
  return (
    <TrpcProvider>
      <DeleteButtonInner {...props} />
    </TrpcProvider>
  )
}

function DeleteButtonInner(props: DeleteButton.Props) {
  const mutation = trpc.deleteEntries.useMutation({
    onSuccess: () => (window.location.href = window.location.pathname + `?reload=true`),
  })
  return (
    <button disabled={!mutation.isIdle} className={props.className} onClick={() => mutation.mutate(props)}>
      {props.children || 'Delete Artifact'}
    </button>
  )
}
