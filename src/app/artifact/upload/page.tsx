'use client'

import {motion, AnimatePresence} from 'framer-motion'
import {useSearchParams} from 'next/navigation'
import {useState} from 'react'
import {trpc} from '~/client/trpc'

const BrickProgressBar = ({progress}: {progress: {[key: string]: number}}) => {
  const totalProgress = Object.values(progress).reduce((sum, value) => sum + value, 0)
  const bricks = Array.from({length: 30}, (_, i) => i)
  const filledBricks = Math.floor((totalProgress / 300) * 30)

  return (
    <div className="flex flex-wrap w-full h-18 bg-amber-300 rounded-md overflow-hidden">
      {bricks.map(brick => (
        <motion.div
          key={brick}
          className="h-1/3 w-[10%] bg-amber-700 border-r-2 border-b-2 border-amber-300 last:border-r-0"
          initial={{scaleY: 0}}
          animate={{scaleY: brick < filledBricks ? 1 : 0}}
          transition={{duration: 0.5, ease: 'easeOut'}}
          style={{
            originY: 1,
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 10px)',
          }}
        />
      ))}
    </div>
  )
}

type SubscriptionData = Parameters<Parameters<typeof trpc.startArtifactProcessing.useSubscription>[1]['onData']>[0]

export default function ArtifactLoader() {
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null)
  const searchParams = useSearchParams()
  const artifactId = searchParams?.get('artifactId') || undefined
  const [isReady, setIsReady] = useState(false)
  const stage = subscriptionData?.stage || 'not_started'
  const isProcessing = stage !== 'not_started' && stage !== 'complete'

  trpc.startArtifactProcessing.useSubscription(
    {artifactId: artifactId as string},
    {
      enabled: Boolean(artifactId && isReady) && stage !== 'complete',
      onData: setSubscriptionData,
      onError: error => {
        console.error(error)
      },
    },
  )

  const handleStart = () => {
    setIsReady(true)
    setSubscriptionData(null)
  }

  return (
    <div className="min-h-screen bg-amber-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-8 text-amber-900">🗿 artifact.ci</h1>
        <div className="bg-amber-200 rounded-lg shadow-lg p-6 mb-8">
          <div className="h-20">
            <AnimatePresence mode="wait">
              <motion.div
                key={stage}
                initial={{opacity: 0, y: 20}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -20}}
                transition={{duration: 0.5}}
                className="text-center"
              >
                {stage === 'complete' && (
                  <p className="text-xl text-green-700 font-semibold jsidosjdidsofifj">{subscriptionData?.message}</p>
                )}
                {isProcessing && (
                  <p className="text-xl font-semibold mb-4 text-amber-800">{subscriptionData?.message}</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-4">
            <BrickProgressBar progress={{p: subscriptionData?.progress}} />
          </div>
        </div>
        <div className="flex justify-center">
          <button
            onClick={handleStart}
            disabled={isProcessing}
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Start Ritual'}
          </button>
        </div>
      </div>
    </div>
  )
}
