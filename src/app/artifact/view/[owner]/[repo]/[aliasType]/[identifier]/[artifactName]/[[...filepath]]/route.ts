import {NextResponse} from 'next/server'
import {loadArtifact, PathParams} from '../load-artifact.server'
import {auth} from '~/auth'
import {logger} from '~/tag-logger'

// sample: http://localhost:3000/artifact/view/mmkal/artifact.ci/11020882214/mocha/output.html
export const GET = auth(async (request, {params}) => {
  return logger
    .try('request', () => loadArtifact(request, {params: params as PathParams}))
    .catch(error => {
      logger.error(error)
      return NextResponse.json({message: 'Internal server error'}, {status: 500})
    })
})
