import {initTRPC} from '@trpc/server'
import {z} from 'zod'
import {Id} from '../db'
import {storeArtifact} from '~/app/artifact/upload/actions'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  startArtifactProcessing: publicProcedure
    .input(
      z.object({
        artifactId: Id('artifact'), //
      }),
    )
    .subscription(async function* ({input}) {
      for await (const event of storeArtifact(input)) {
        yield event
      }
    }),
})
