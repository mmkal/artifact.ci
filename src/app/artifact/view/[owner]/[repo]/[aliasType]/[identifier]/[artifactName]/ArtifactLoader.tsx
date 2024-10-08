'use client'

import {useMutation} from '@tanstack/react-query'
import {Check, ChevronRight} from 'lucide-react'
import {useSearchParams} from 'next/navigation'
import React, {Suspense} from 'react'
import {FileList} from './FileList'
import {clientUpload} from './client-upload'
import {type PathParams} from '~/app/artifact/view/params'

type Update = {stage: string; message: string; onClick?: () => void}

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
  const initialUpdates: Update[] = [{stage: 'welcome', message: 'Welcome, ' + params.githubLogin} as Update].concat(
    reload ? [{stage: 'trigger', message: 'Load artifact', onClick: () => mutation.mutate(params)}] : [],
  )
  const [updates, setUpdates] = React.useState<Update[]>(initialUpdates)
  const fileListRef = React.useRef<HTMLDivElement>(null)

  const onProgress = React.useCallback((stage: string, message: string) => {
    setUpdates(prev => {
      const next = [...prev]
      if (stage === next.at(-1)?.stage) next.pop()
      return [...next, {stage, message}]
    })
  }, [])

  const mutation = useMutation({
    mutationFn: (input: {artifactId: string}) => {
      setUpdates(initialUpdates)
      return clientUpload({...input, onProgress})
    },
    onSuccess: () => {
      onProgress('success', 'Artifact ready')
      setTimeout(() => fileListRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}), 300)
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

  return (
    <>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        <div data-element="updates-list" className="snap-start">
          {updates.map((update, index, {length}) => {
            const prefix =
              update.stage === 'success' || index < length - 1 ? (
                <Check className="inline text-xs" />
              ) : (
                <ChevronRight className="inline text-xs" />
              )
            if (update.onClick) {
              return (
                <span key={update.stage + update.message} className="py-2">
                  {prefix}{' '}
                  <button
                    disabled={index < length - 1}
                    onClick={update.onClick}
                    className="DISABLEDbg-amber-700/30 hover:bg-amber-600/20 text-amber-100 font-bold py-1 px-3 rounded border border-amber-400/50 transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {update.message}
                  </button>
                </span>
              )
            }
            return (
              <div
                key={update.stage + update.message}
                className={`py-2 rounded-md ${update.stage === 'error' ? 'text-red-400' : 'hover:bg-gray-900'}`}
              >
                {prefix} {update.message}
              </div>
            )
          })}
          {!mutation.isPending && updates.length === 0 && (
            <div className="p-3 rounded-md hover:bg-gray-900">
              {'>'} Welcome, {params.githubLogin}. {reload ? '' : 'Getting ready...'}
            </div>
          )}
        </div>
        {mutation.isSuccess && (
          <div ref={fileListRef} className="snap-start pb-[100%]">
            <FileList
              names={mutation.data.records.map(r => r.entry_name)}
              params={params}
              artifactId={params.artifactId}
            />
          </div>
        )}
      </div>
    </>
  )
}
