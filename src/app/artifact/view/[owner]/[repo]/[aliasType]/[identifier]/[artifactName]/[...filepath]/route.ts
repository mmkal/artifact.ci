import {NextResponse} from 'next/server'
import {loadArtifact, loadFile} from '../load-artifact.server'
import {checkContext} from '~/analytics/posthog-server'
import {PathParams, toPath} from '~/app/artifact/view/params'
import {auth} from '~/auth'
import {logger} from '~/tag-logger'

// sample: http://localhost:3000/artifact/view/mmkal/artifact.ci/11020882214/mocha/output.html
export const GET = auth(async (request, {params}) => {
  checkContext('loadArtifactRouteHandler')
  const githubLogin = request?.auth?.user?.github_login
  if (!githubLogin) {
    const redirectTo = new URL('/api/auth/signin', request.nextUrl.origin)
    redirectTo.searchParams.set('callbackUrl', request.nextUrl.toString().replace(request.nextUrl.origin, ''))
    return NextResponse.redirect(redirectTo)
  }
  return logger
    .try('loadArtifact', async () => {
      const pathParams = PathParams.parse(params)
      if (pathParams.aliasType === 'sha' && pathParams.identifier.length > 7) {
        const fixedPath = toPath({...pathParams, identifier: pathParams.identifier.slice(0, 7)})
        const redirectTo = new URL(fixedPath + request.nextUrl.search, request.nextUrl.origin)
        return NextResponse.redirect(redirectTo)
      }
      const artifact = await loadArtifact(githubLogin, {params: pathParams})
      if (artifact.outcome === '4xx') {
        return NextResponse.json(artifact, {status: 404})
      }
      if (artifact.outcome === 'not_uploaded_yet') {
        return NextResponse.json(artifact, {status: 404})
      }
      if (artifact.outcome !== '2xx') {
        artifact satisfies never // this ensures typescript believes we've handled all cases
        throw new Error('Unexpected outcome', {cause: artifact})
      }
      if (!artifact.storagePathname) {
        return NextResponse.redirect(
          new URL('/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]', request.nextUrl.origin),
        )
      }

      return loadFile(artifact.storagePathname, pathParams)
    })
    .catch(error => {
      logger.error(error)
      return NextResponse.json({message: 'Internal server error'}, {status: 500})
    })
})
