import {fetchRequestHandler} from '@trpc/server/adapters/fetch'
import {appRouter, TrpcContext} from '../../../../server/trpc'
import {auth} from '~/auth'
import {logger} from '~/tag-logger'

const handler = auth(request => {
  return logger.run(`trpc`, () => {
    return fetchRequestHandler({
      router: appRouter,
      req: request,
      endpoint: '/api/trpc',
      createContext: async (): Promise<TrpcContext> => ({session: request.auth}),
      onError: ({error, path}) => logger.tag(`path=${path}`).error(error),
    })
  })
})

export const GET = handler
export const POST = handler
