import {fetchRequestHandler} from '@trpc/server/adapters/fetch'
import {appRouter} from '../../../../server/trpc'
import {logger} from '~/tag-logger'

const handler = (req: Request) => {
  return fetchRequestHandler({
    router: appRouter,
    req,
    endpoint: '/api/trpc',
    onError({error, path}) {
      logger.run(`path=${path}`, () => {
        logger.error(error)
      })
    },
  })
}

export const GET = handler
export const POST = handler
