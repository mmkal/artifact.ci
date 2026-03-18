import {NextResponse} from 'next/server'
import {type ArtifactResolveRequest, type ArtifactResolveResponse} from '@artifact/domain/artifact/edge-contract'
import {PathParams, toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import {loadArtifact} from '~/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/load-artifact.server'
import {auth} from '~/auth'

export const POST = auth(async request => {
  const payload = (await request.json()) as ArtifactResolveRequest
  const params = PathParams.parse(payload.params)
  const githubLogin = request.auth?.user?.github_login
  const resolved = await loadArtifact(githubLogin, {params})

  const body: ArtifactResolveResponse = mapResultToEdgeResponse({
    resolved,
    params,
    requestPathname: payload.requestPathname,
    raw: payload.raw,
  })

  return NextResponse.json(body)
})

function mapResultToEdgeResponse(input: {
  resolved: Awaited<ReturnType<typeof loadArtifact>>
  params: ArtifactResolveRequest['params']
  requestPathname: string
  raw: boolean
}): ArtifactResolveResponse {
  const {resolved, params, requestPathname, raw} = input

  if (resolved.code === 'not_authorized' && !resolved.githubLogin) {
    return {
      kind: 'redirect',
      location: `/login?${new URLSearchParams({callbackUrl: requestPathname})}`,
      status: 302,
    }
  }

  if (resolved.code === 'not_uploaded_yet') {
    return {
      kind: 'redirect',
      location: `${toAppArtifactPath(params)}?reload=true`,
      status: 307,
    }
  }

  if (resolved.code === 'artifact_not_found' || resolved.code === 'upload_not_found') {
    return {
      kind: 'json',
      status: 404,
      body: resolved,
    }
  }

  if (resolved.code === 'not_authorized') {
    return {
      kind: 'json',
      status: 403,
      body: resolved,
    }
  }

  if (!resolved.storagePathname) {
    return {
      kind: 'redirect',
      location: toAppArtifactPath(params),
      status: 307,
    }
  }

  return {
    kind: 'serve-file',
    storagePathname: resolved.storagePathname,
    params,
    raw,
  }
}
