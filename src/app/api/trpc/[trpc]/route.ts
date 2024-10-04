import {fetchRequestHandler} from '@trpc/server/adapters/fetch'
import {appRouter} from '../../../../server/trpc'

const handler = (req: Request) => {
  return fetchRequestHandler({
    router: appRouter,
    req,
    endpoint: '/api/trpc',
  })
}

export const GET = handler
export const POST = handler
