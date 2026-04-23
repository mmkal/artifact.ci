import {useMutation} from '@tanstack/react-query'
import {useEffect, useRef, useState, Suspense} from 'react'
import type {PathParams} from '@artifact/domain/artifact/path-params'
import {FileList} from './file-list'

type Update = {stage: string; message: string; onClick?: () => void}

export type ArtifactLoaderProps = PathParams & {
  artifactId: string
  githubLogin: string | undefined
  entry: string | null
  reload: boolean
}

export function ArtifactLoader(props: ArtifactLoaderProps) {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ArtifactLoaderInner {...props} />
    </Suspense>
  )
}

function ArtifactLoaderInner(props: ArtifactLoaderProps) {
  const {reload} = props
  const initialUpdates: Update[] = [
    {stage: 'welcome', message: 'Welcome, ' + (props.githubLogin || 'guest')},
  ]

  const [updates, setUpdates] = useState<Update[]>(initialUpdates)
  const fileListRef = useRef<HTMLDivElement>(null)

  const onProgress = (stage: string, message: string) => {
    setUpdates(prev => {
      const next = [...prev]
      if (stage === next.at(-1)?.stage) next.pop()
      return [...next, {stage, message}]
    })
  }

  const mutation = useMutation({
    mutationFn: async (input: {artifactId: string}) => {
      setUpdates(initialUpdates)
      // Dynamic import: clientUpload pulls in unzipit, which is CJS and
      // can't be loaded by Vite's SSR module runner. Deferring to runtime
      // keeps SSR happy while the client fetches the module on demand.
      const {clientUpload} = await import('@artifact/domain/artifact/client-upload')
      return clientUpload({...input, onProgress, trpcUrl: '/api/trpc'})
    },
    onSuccess: () => {
      onProgress('success', 'Artifact ready')
      setTimeout(() => fileListRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}), 300)
    },
    onError: error => setUpdates(prev => [...prev, {stage: 'error', message: error.message}]),
  })

  useEffect(() => {
    if (mutation.status === 'idle' && props.artifactId && !reload) {
      const timeout = setTimeout(() => mutation.mutate({artifactId: props.artifactId}), 200)
      return () => clearTimeout(timeout)
    }
  }, [mutation.status, props.artifactId, mutation, reload])

  return (
    <div className="browser__loader">
      <div className="browser__updates">
        {updates.map((update, index, {length}) => {
          const isLast = index === length - 1
          const prefix = update.stage === 'success' || !isLast ? '✓' : '›'
          if (update.onClick) {
            return (
              <div key={update.stage + update.message} className="browser__update">
                {prefix}{' '}
                <button
                  type="button"
                  disabled={index < length - 1}
                  onClick={update.onClick}
                  className="browser__action"
                >
                  {update.message}
                </button>
              </div>
            )
          }
          return (
            <div
              key={update.stage + update.message}
              className={`browser__update ${update.stage === 'error' ? 'browser__update--error' : ''}`}
            >
              {prefix} {update.message}
            </div>
          )
        })}
      </div>
      {mutation.isSuccess && (
        <div ref={fileListRef} className="browser__post-load">
          <FileList
            names={mutation.data.records.map(r => r.entry_name)}
            params={props}
            artifactId={props.artifactId}
          />
        </div>
      )}
    </div>
  )
}
