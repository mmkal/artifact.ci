'use client'

import {useMutation} from '@tanstack/react-query'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {useSearchParams} from 'next/navigation'
import React, {Suspense} from 'react'
import {FileList} from './FileList'
import {clientUpload} from './client-upload'
import {PathParams} from './load-artifact.server'

type Update = {stage: string; message: string}

export namespace ArtifactLoader {
  export type Params = PathParams & {
    artifactId: string
    githubLogin: string
    entry: string | null
  }
}

function ArtifactLoaderInner(params: ArtifactLoader.Params) {
  const searchParams = useSearchParams()
  const reload = searchParams?.get('reload') === 'true'
  const [updates, setUpdates] = React.useState([] as Update[])
  const detailsRef = React.useRef<HTMLDetailsElement>(null)

  const mutation = useMutation({
    mutationFn: (input: {artifactId: string}) => {
      setUpdates([])
      return clientUpload({
        ...input,
        onProgress: (newStage, message) =>
          setUpdates(prev => {
            const next = [...prev]
            if (newStage === next.at(-1)?.stage) next.pop()
            return [...next, {stage: newStage, message}]
          }),
      })
    },
    onSuccess: () => {
      // Automatically close the details element after a short delay
      setTimeout(() => {
        if (detailsRef.current) detailsRef.current.open = false
      }, 500)
    },
    onError: error => setUpdates(prev => [...prev, {stage: 'error', message: error.message}]),
  })

  React.useEffect(() => {
    if (mutation.status === 'idle' && params.artifactId && !reload) {
      const timeout = setTimeout(() => mutation.mutate(params), 200)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.status, params.artifactId, mutation.mutate, reload])

  const isProcessing = mutation.isPending
  return (
    <div className="bg-gray-950 text-amber-200/80 p-6 font-mono min-h-screen">
      <h1 className="text-3xl font-bold mb-6 border-b-2 border-amber-300/50 pb-2">
        🗿 artifact: {params.artifactName}
      </h1>

      <details ref={detailsRef} className="group mb-8" open>
        <summary className="flex items-center justify-between mb-4 border-b border-amber-300/50 pb-2 cursor-pointer list-none">
          <h2 className="text-2xl font-semibold flex items-center">
            <span>{mutation.isSuccess ? 'Artifact ready' : 'Preparing Artifact'}</span>
            <ChevronDown className="h-6 w-6 ml-2 transform transition-transform duration-200 group-open:rotate-180" />
          </h2>
          {(mutation.isIdle || reload) && (
            <button
              onClick={e => {
                e.preventDefault()
                mutation.mutate(params)
              }}
              disabled={isProcessing}
              className="bg-amber-700/30 hover:bg-amber-600/50 text-amber-100 font-bold py-1 px-3 rounded border border-amber-400/50 transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prepare
            </button>
          )}
        </summary>
        <div className="space-y-2 mt-4 overflow-hidden transition-all duration-500 ease-in-out">
          {updates.map((line, index) => (
            <div
              key={index}
              className={`p-3 rounded-md ${
                line.stage === 'error' ? 'text-red-400' : 'border border-amber-400/30 hover:bg-gray-900'
              }`}
            >
              {'> ' + line.message}
            </div>
          ))}
          {!isProcessing && updates.length === 0 && (
            <div className="p-3 rounded-md border border-amber-400/30 hover:bg-gray-900">
              {'>'} Welcome, {params.githubLogin}. {reload ? 'Click Prepare to start.' : 'Getting ready...'}
            </div>
          )}
        </div>
      </details>

      {mutation.isSuccess && <FileList entries={mutation.data.records.map(r => r.entry_name)} params={params} />}
    </div>
  )
}

export function ArtifactLoader(params: ArtifactLoader.Params) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ArtifactLoaderInner {...params} />
    </Suspense>
  )
}
