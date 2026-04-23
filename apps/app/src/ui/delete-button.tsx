import {trpc} from '../trpc/client'

export function DeleteButton({artifactId}: {artifactId: string}) {
  const mutation = trpc.deleteEntries.useMutation({
    onSuccess: () => {
      window.location.href = window.location.pathname + `?reload=true`
    },
  })
  return (
    <button
      type="button"
      disabled={!mutation.isIdle}
      className="browser__delete"
      onClick={() => mutation.mutate({artifactId})}
    >
      &gt; Delete Entries
    </button>
  )
}
