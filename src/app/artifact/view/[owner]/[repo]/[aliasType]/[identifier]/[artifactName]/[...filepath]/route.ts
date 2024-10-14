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
        // redirect to the short sha - could probably just remove this actually
        const fixedPath = toPath({...pathParams, identifier: pathParams.identifier.slice(0, 7)})
        const redirectTo = new URL(fixedPath + request.nextUrl.search, request.nextUrl.origin)
        return NextResponse.redirect(redirectTo)
      }

      const res = await loadArtifact(githubLogin, {params: pathParams})
      if (res.code === 'not_uploaded_yet' || res.code === 'upload_not_found' || res.code === 'artifact_not_found') {
        return NextResponse.json(res, {status: 404})
      }
      if (res.code === 'not_authorized') {
        return NextResponse.json(res, {status: 403})
      }
      if (res.code !== '2xx') {
        res satisfies never // ensure typescript thinks we've handled all cases
        throw new Error('Unexpected outcome', {cause: res})
      }
      if (!res.storagePathname) {
        return NextResponse.redirect(
          new URL('/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]', request.nextUrl.origin),
        )
      }

      return loadFile(res.storagePathname, pathParams)
    })
    .catch(error => {
      logger.error(error)
      return NextResponse.json({message: 'Internal server error'}, {status: 500})
    })
})
