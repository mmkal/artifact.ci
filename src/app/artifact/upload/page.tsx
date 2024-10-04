'use client'

import {motion, AnimatePresence} from 'framer-motion'
import {useState} from 'react'
import {trpc} from '~/client/trpc'

const stages = [
  {id: 'idle', text: 'Awaiting sacred ritual'},
  {id: 'download', text: 'Downloading the sacred zip'},
  {id: 'extract', text: 'Extracting ancient artifacts'},
  {id: 'upload', text: 'Offering to the cloud gods'},
  {id: 'ready', text: 'Ritual complete'},
]

const BrickProgressBar = ({progress}: {progress: number}) => {
  const bricks = Array.from({length: 10}, (_, i) => i)
  const filledBricks = Math.floor(progress * 10)

  return (
    <div className="flex w-full h-6 bg-amber-300 rounded-md overflow-hidden">
      {bricks.map(brick => (
        <motion.div
          key={brick}
          className="h-full bg-amber-700 border-r-2 border-amber-300 last:border-r-0"
          initial={{width: 0}}
          animate={{width: brick < filledBricks ? '10%' : 0}}
          transition={{duration: 0.5, ease: 'easeOut'}}
          style={{
            originX: 1,
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 10px)',
          }}
        />
      ))}
    </div>
  )
}

export default function ArtifactLoader() {
  const [currentStage, setCurrentStage] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)

  trpc.startArtifactProcessing.useSubscription(
    {artifactId: undefined}, // todo
    {
      enabled: isProcessing,
      onData: data => {
        const stageIndex = stages.findIndex(stage => stage.id === data.stage)
        setCurrentStage(stageIndex)
        setProgress(data.progress)
        if (data.stage === 'upload' && data.progress === 100) {
          setIsProcessing(false)
          setCurrentStage(stages.length - 1)
        }
      },
      onError: err => {
        console.error('Subscription error:', err)
        setIsProcessing(false)
      },
    },
  )

  const handleStart = () => {
    setIsProcessing(true)
    setCurrentStage(1)
    setProgress(0)
  }

  return (
    <div className="min-h-screen bg-amber-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-8 text-amber-900">Aztec Artifact Server</h1>
        <div className="bg-amber-200 rounded-lg shadow-lg p-6 mb-8">
          <div className="h-20">
            {' '}
            {/* Fixed height container for text */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStage}
                initial={{opacity: 0, y: 20}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -20}}
                transition={{duration: 0.5}}
                className="text-center"
              >
                <p className="text-xl font-semibold mb-4 text-amber-800">{stages[currentStage].text}</p>
                {currentStage === stages.length - 1 && (
                  <p className="text-green-700 font-semibold">Your artifacts are ready!</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-4">
            <BrickProgressBar progress={progress / 100} />
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
