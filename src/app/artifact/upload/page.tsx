'use client'

import {useMutation} from '@tanstack/react-query'
import {useSearchParams as useSearchParamsBase} from 'next/navigation'
import {useSession} from 'next-auth/react'
import {useCallback, useEffect, useState} from 'react'
import {clientUpload} from './client-upload'
import {AugmentedSession} from '~/auth'
import {trpc} from '~/client/trpc'

type SubscriptionData = {stage: string; message: string}

function useSearchParams() {
  try {
    return useSearchParamsBase()
  } catch {
    // i don't want to use suspense
    return null
  }
}

// export function ArtifactLoader() {
//   const [updates, setSubscriptionDataArray] = useState<SubscriptionData[]>([])
//   const searchParams = useSearchParams()
//   const artifactId = searchParams?.get('artifactId') || undefined
//   const [isReady, setIsReady] = useState(false)
//   const stage = updates.at(-1)?.stage || 'not_started'
//   const isProcessing = stage !== 'not_started' && stage !== 'complete'

//   useEffect(() => {
//     const callbackUrl = searchParams?.get('callbackUrl')
//     if (callbackUrl?.startsWith('/') && stage === 'complete' && confirm('redirect?')) {
//       const newUrl = new URL(callbackUrl, window.location.origin)
//       newUrl.searchParams.set('redirected', 'true')
//       window.location.href = newUrl.toString()
//     }
//   }, [searchParams, stage])

//   console.log(Boolean(artifactId && isReady) && stage !== 'complete', artifactId, isReady, stage)
//   trpc.startArtifactProcessing.useSubscription(
//     {artifactId: artifactId as string},
//     {
//       enabled: updates.length === 0 && Boolean(artifactId && isReady) && stage !== 'complete',
//       onData: data => {
//         setSubscriptionDataArray(prev => {
//           if (prev.at(-1)?.stage === data.stage) {
//             return [...prev.slice(0, -1), data]
//           }
//           return [...prev, data]
//         })
//       },
//       onError: error => {
//         alert(error.message)
//         console.error(error)
//         setSubscriptionDataArray(prev => [
//           ...prev,
//           {stage: 'error' as never, message: 'An error occurred during the ritual.', progress: 0},
//         ])
//       },
//     },
//   )

//   const handleStart = () => {
//     setIsReady(true)
//     setSubscriptionDataArray([])
//   }

//   return (
//     <div className="min-h-screen bg-amber-100 flex items-center justify-center p-4">
//       <div className="w-full max-w-2xl">
//         <h1 className="text-4xl font-mono font-bold text-center mb-8 text-amber-900">🗿 artifact.ci</h1>
//         <div className="bg-amber-200 rounded-lg border-2 border-amber-700 p-6 mb-8 font-mono text-amber-800 shadow-lg">
//           <div className="mb-4">
//             <span className="text-amber-700">$</span> ./invoke_aztec_ritual.sh
//           </div>
//           <div className="h-64 overflow-y-auto bg-amber-100 p-2 rounded">
//             <div className="font-mono text-amber-800 whitespace-pre-wrap">
//               {updates.map((line, index) => (
//                 <div key={index}>{`> ${line.message}`}</div>
//               ))}
//             </div>
//             {!isProcessing && stage !== 'complete' && updates.length === 0 && (
//               <div className="text-amber-700">Awaiting ritual initiation...</div>
//             )}
//           </div>
//         </div>
//         <div className="flex justify-center">
//           <button
//             onClick={handleStart}
//             disabled={isProcessing}
//             className="bg-amber-500 hover:bg-amber-600 text-white font-mono font-bold py-2 px-4 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {isProcessing ? 'RITUAL IN PROGRESS...' : 'INVOKE THE RITUAL'}
//           </button>
//           {isProcessing && <button onClick={() => setIsReady(false)}>Cancel</button>}
//         </div>
//       </div>
//     </div>
//   )
// }

export function ArtifactLoader2() {
  const searchParams = useSearchParams()
  const artifactId = searchParams?.get('artifactId') || undefined
  const session = useSession() as Omit<ReturnType<typeof useSession>, 'data'> & {data: AugmentedSession | null}
  const [updates, setUpdates] = useState([] as SubscriptionData[])
  const stage = updates.at(0)?.stage
  const mutation = useMutation({
    mutationFn: (x: {artifactId: string; githubToken: string}) => {
      return clientUpload({
        ...x,
        onProgress: (newStage, message) =>
          setUpdates(prev => {
            if (newStage === prev.at(-1)?.stage) {
              return [...prev.slice(0, -1), {stage: newStage, message}]
            }
            return [...prev, {stage: newStage, message}]
          }),
      })
    },
    onError: error => {
      setUpdates(prev => [...prev, {stage: 'error', message: error.message}])
    },
  })
  const isProcessing = mutation.isPending

  const gogo = useCallback(() => {
    const callbackUrl = searchParams?.get('callbackUrl')
    if (callbackUrl?.startsWith('/')) {
      const newUrl = new URL(callbackUrl, window.location.origin)
      newUrl.searchParams.set('redirected', 'true')
      window.location.href = newUrl.toString()
    }
  }, [searchParams])

  return (
    <div className="min-h-screen bg-amber-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-mono font-bold text-center mb-8 text-amber-900">🗿 artifact.ci</h1>
        <div className="bg-amber-200 rounded-lg border-2 border-amber-700 p-6 mb-8 font-mono text-amber-800 shadow-lg">
          <div className="mb-4">
            <span className="text-amber-700">$</span> ./invoke_aztec_ritual.sh
          </div>
          <div className="h-64 overflow-y-auto bg-amber-100 p-2 rounded">
            <div className="font-mono text-amber-800 whitespace-pre-wrap">
              {updates.map((line, index) => (
                <div key={index}>{`> ${line.message}`}</div>
              ))}
            </div>
            {!isProcessing && stage !== 'complete' && updates.length === 0 && (
              <div className="text-amber-700">Awaiting ritual initiation...</div>
            )}
          </div>
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => {
              if (!session?.data?.jwt_access_token) throw new Error('no access token: ' + JSON.stringify([session]))
              mutation.mutate({
                artifactId: artifactId!.slice(),
                githubToken: session.data.jwt_access_token,
              })
            }}
            disabled={isProcessing}
            className="bg-amber-500 hover:bg-amber-600 text-white font-mono font-bold py-2 px-4 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'RITUAL IN PROGRESS...' : 'INVOKE THE RITUAL'}
          </button>
          {mutation.status === 'success' && (
            <button
              onClick={() => gogo()}
              className="bg-amber-500 hover:bg-amber-600 text-white font-mono font-bold py-2 px-4 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Go there
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArtifactLoader2
