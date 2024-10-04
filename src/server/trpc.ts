import {initTRPC} from '@trpc/server'
import {z} from 'zod'
import {Id, client, sql} from '../db'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

// Define the type for the yielded data
type ArtifactProcessingStatus = {
  stage: 'download' | 'extract' | 'upload'
  progress: number
}

export const appRouter = router({
  startArtifactProcessing: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'), //
      }),
    )
    .subscription(async function* ({input}) {
      //   const artifact = await client.maybeOne(sql`
      //     select * from artifacts where id = ${input.artifactId}
      //   `)
      const artifact = {name: 'artifacto'}
      yield {
        stage: 'downloaded' as const,
        message: `Got artifact ${artifact?.name}`,
        progress: 10,
      }
      await new Promise(r => setTimeout(r, 1000))

      yield {
        stage: 'complete' as const,
        message: 'Got bored',
        progress: 100,
      }
      //   yield {stage: 'download', progress: 0}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'download', progress: 50}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'download', progress: 100}

      //   await new Promise(r => setTimeout(r, 500))

      //   yield {stage: 'extract', progress: 0}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'extract', progress: 50}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'extract', progress: 100}

      //   await new Promise(r => setTimeout(r, 500))

      //   yield {stage: 'upload', progress: 0}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'upload', progress: 50}
      //   await new Promise(r => setTimeout(r, 1000))
      //   yield {stage: 'upload', progress: 100}
    }),
})

export type AppRouter = typeof appRouter
