import {initTRPC} from '@trpc/server'
import {z} from 'zod'
import {Id} from '../db'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  startArtifactProcessing: publicProcedure
    .input(
      z
        .object({
          artifactId: Id('artifact').optional(), //
        })
        .default({}),
    )
    .subscription(async function* () {
      console.log('starting<<<<<<<<<<<')
      yield {stage: 'download', progress: 0}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'download', progress: 50}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'download', progress: 100}

      await new Promise(r => setTimeout(r, 500))

      yield {stage: 'extract', progress: 0}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'extract', progress: 50}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'extract', progress: 100}

      await new Promise(r => setTimeout(r, 500))

      yield {stage: 'upload', progress: 0}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'upload', progress: 50}
      await new Promise(r => setTimeout(r, 1000))
      yield {stage: 'upload', progress: 100}
    }),
})

export type AppRouter = typeof appRouter
