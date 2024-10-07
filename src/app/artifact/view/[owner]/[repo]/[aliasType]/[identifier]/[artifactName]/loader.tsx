'use client'

import {useMutation} from '@tanstack/react-query'
import {useSearchParams as useSearchParamsBase} from 'next/navigation'
import React from 'react'
import {clientUpload} from './client-upload'

type SubscriptionData = {stage: string; message: string}

function useSearchParams() {
  try {
    return useSearchParamsBase()
  } catch {
    // i don't want to use suspense
    return null
  }
}

export type ArtifactUploadPageSearchParams = {
  artifactId: string
  artifactName: string
  aliasType: string
  identifier: string
  entry: string
}

export function ArtifactLoader({githubLogin}: {githubLogin: string}) {
  const rawSearchParams = useSearchParams()
  const searchParams = React.useMemo(
    () => (rawSearchParams ? (Object.fromEntries(rawSearchParams.entries()) as ArtifactUploadPageSearchParams) : null),
    [rawSearchParams],
  )
  const artifactId = searchParams?.artifactId || undefined
  const [updates, setUpdates] = React.useState([] as SubscriptionData[])
  const stage = updates.at(0)?.stage
  const mutation = useMutation({
    mutationFn: (input: {artifactId: string}) => {
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
    onSuccess: ({artifact, entrypoints}) => {
      setUpdates(prev => [...prev, {stage: 'success', message: 'Taking you to your artifact...'}])
      if (!searchParams) throw new Error('searchParams not found')
      const entry = searchParams.entry || entrypoints.entrypoints[0]
      window.location.href = `/artifact/view/${artifact.owner}/${artifact.repo}/${searchParams.aliasType}/${searchParams.identifier}/${artifact.name}/${entry}`
    },
    onError: error => setUpdates(prev => [...prev, {stage: 'error', message: error.message}]),
  })
  React.useEffect(() => {
    if (mutation.status === 'idle' && artifactId) {
      const timeout = setTimeout(() => mutation.mutate({artifactId}), 200)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.status, artifactId, mutation.mutate])
  const isProcessing = mutation.isPending

  return (
    <div className="min-h-screen bg-amber-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-mono font-bold text-center mb-8 text-amber-900">🗿 artifact.ci</h1>
        <div className="bg-amber-200 rounded-lg border-2 border-amber-700 p-6 mb-8 font-mono text-amber-800 shadow-lg">
          <div className="mb-4">
            <span className="text-amber-700">$</span> preparing artifact {searchParams?.artifactName || ''}
          </div>
          <div className="h-64 overflow-y-auto bg-amber-100 p-2 rounded">
            <div className="font-mono text-amber-800 whitespace-pre-wrap">
              {updates.map((line, index) => (
                <div className={line.stage === 'error' ? 'text-red-700' : ''} key={index}>{`> ${line.message}`}</div>
              ))}
            </div>
            {!isProcessing && stage !== 'complete' && updates.length === 0 && (
              <div className="text-amber-700">Welcom, {githubLogin}. Getting ready...</div>
            )}
          </div>
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => {
              mutation.mutate({
                artifactId: artifactId!.slice(),
              })
            }}
            disabled={isProcessing}
            className="hidden bg-amber-500 hover:bg-amber-600 text-white font-mono font-bold py-2 px-4 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Preparing...' : 'Prepare'}
          </button>
        </div>
      </div>
    </div>
  )
}
