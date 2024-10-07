'use client'

import {useMutation} from '@tanstack/react-query'
import {Check} from 'lucide-react'
import {useSearchParams} from 'next/navigation'
import React, {Suspense, useRef, useEffect} from 'react'
import {FileList} from './FileList'
import {clientUpload} from './client-upload'
import {type PathParams} from '~/app/artifact/view/params'

type Update = {stage: string; message: string}

export namespace ArtifactLoader {
  export type Params = PathParams & {
    artifactId: string
    githubLogin: string
    entry: string | null
  }
}

export function ArtifactLoader(params: ArtifactLoader.Params) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ArtifactLoaderInner {...params} />
    </Suspense>
  )
}

function ArtifactLoaderInner(params: ArtifactLoader.Params) {
  const searchParams = useSearchParams()
  const reload = searchParams?.get('reload') === 'true'
  const [updates, setUpdates] = React.useState([] as Update[])
  const detailsRef = React.useRef<HTMLDetailsElement>(null)
  const fileListRef = useRef<HTMLDivElement>(null)

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
  }, [mutation.status, params.artifactId, mutation.mutate, reload, params])

  useEffect(() => {
    if (mutation.isSuccess && fileListRef.current) {
      fileListRef.current.scrollIntoView({behavior: 'smooth', block: 'start'})
    }
  }, [mutation.isSuccess])

  return (
    <>
      <div className="mb-4 flex items-center justify-between pr-5">
        <h2 className="text-2xl font-semibold">
          {mutation.isSuccess
            ? [<Check key="check" className="inline mr-1" />, 'Artifact ready']
            : 'Preparing Artifact'}
        </h2>
        {(mutation.isIdle || reload) && (
          <button
            onClick={() => mutation.mutate(params)}
            disabled={mutation.isPending}
            className="bg-amber-700/30 hover:bg-amber-600/50 text-amber-100 font-bold py-1 px-3 rounded border border-amber-400/50 transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Prepare
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        <div className="snap-start">
          {updates.map((line, index) => (
            <div
              key={index}
              className={`p-3 rounded-md ${line.stage === 'error' ? 'text-red-400' : 'hover:bg-gray-900'}`}
            >
              {'> ' + line.message}
            </div>
          ))}
          {!mutation.isPending && updates.length === 0 && (
            <div className="p-3 rounded-md hover:bg-gray-900">
              {'>'} Welcome, {params.githubLogin}. {reload ? 'Click Prepare to start.' : 'Getting ready...'}
            </div>
          )}
        </div>
        {mutation.isSuccess && (
          <div ref={fileListRef} className="snap-start pb-[100%]">
            <FileList names={mutation.data.records.map(r => r.entry_name)} params={params} />
          </div>
        )}
      </div>
    </>
  )
}
