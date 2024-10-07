'use client'

import {useMutation} from '@tanstack/react-query'
import React from 'react'
import {clientUpload} from './client-upload'
import {PathParams} from './load-artifact.server'

type SubscriptionData = {stage: string; message: string}

export namespace ArtifactLoader {
  export type Params = PathParams & {
    artifactId: string
    githubLogin: string
    entry: string | null
  }
}

export function ArtifactLoader(params: ArtifactLoader.Params) {
  const [updates, setUpdates] = React.useState([] as SubscriptionData[])
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
    onSuccess: () => {
      setUpdates(prev => [...prev, {stage: 'success', message: 'Taking you to your artifact...'}])
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('reload')
      window.location.href = newUrl.href
      // `/artifact/view/${artifact.owner}/${artifact.repo}/${params.aliasType}/${params.identifier}/${artifact.name}`,
      // const entry = params.entry || entrypoints.entrypoints[0]
      // window.location.href = `/artifact/view/${artifact.owner}/${artifact.repo}/${params.aliasType}/${params.identifier}/${artifact.name}/${entry}`
    },
    onError: error => setUpdates(prev => [...prev, {stage: 'error', message: error.message}]),
  })
  React.useEffect(() => {
    if (mutation.status === 'idle' && params.artifactId) {
      const timeout = setTimeout(() => mutation.mutate(params), 200)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.status, params.artifactId, mutation.mutate])
  const isProcessing = mutation.isPending

  return (
    <div className="bg-gray-950 text-amber-200/80 p-6 font-mono min-h-screen">
      <h1 className="text-3xl font-bold mb-6 border-b-2 border-amber-300/50 pb-2">
        🗿 artifact: {params.artifactName}
      </h1>

      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 border-b border-amber-300/50 pb-2">Preparing Artifact</h2>
        <div className="space-y-2">
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
              {'>'} Welcome, {params.githubLogin}. Getting ready...
            </div>
          )}
        </div>
      </div>

      {mutation.isIdle && (
        <div className="flex justify-center mt-8">
          <button
            onClick={() => mutation.mutate(params)}
            disabled={isProcessing}
            className="bg-amber-700 hover:bg-amber-600 text-amber-100 font-bold py-2 px-4 rounded-md shadow-lg transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Prepare
          </button>
        </div>
      )}
    </div>
  )
}
