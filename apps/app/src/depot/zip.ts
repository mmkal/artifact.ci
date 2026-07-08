import {checkCanAccess} from '@artifact/domain/github/access'
import {getInstallationOctokit} from '@artifact/domain/github/installations'
import {logger} from '@artifact/domain/logging/tag-logger'
import {getRequestSession} from '../auth/request-session'
import {getDb} from '../cloudflare-env'
import {lookupUploadToken} from '../upload-tokens'
import {createDepotClientForConnection, findDepotConnection} from './sync'

interface DepotArtifactRow extends Record<string, unknown> {
  id: string
  depot_artifact_id: string | null
  name: string
  installation_github_id: number
  owner: string
  repo: string
}

/**
 * Streams a Depot-stored artifact zip through the worker. Depot's presigned
 * S3 URLs don't allow cross-origin browser fetches (no CORS on the bucket),
 * so the browser downloads from this same-origin route instead.
 */
export async function handleDepotArtifactZipRequest(request: Request): Promise<Response> {
  const artifactId = new URL(request.url).pathname.split('/').at(-1)!

  const db = getDb()
  let githubLogin = (await getRequestSession(request)).githubLogin
  if (!githubLogin) {
    const uploadToken = request.headers.get('artifactci-upload-token')
    if (uploadToken) githubLogin = (await lookupUploadToken(db, uploadToken)) || undefined
  }
  if (!githubLogin) return Response.json({error: 'not authenticated'}, {status: 401})

  const rows = await db.sql.all<DepotArtifactRow>`
    select a.id, a.depot_artifact_id, a.name, gi.github_id as installation_github_id, r.owner, r.name as repo
    from artifacts a
    join github_installations gi on gi.id = a.installation_id
    join repos r on r.id = a.repo_id
    where a.id = ${artifactId}
  `
  const artifact = rows[0]
  if (!artifact) return Response.json({error: `artifact ${artifactId} not found`}, {status: 404})
  if (!artifact.depot_artifact_id) {
    return Response.json({error: `artifact ${artifactId} is not a depot artifact`}, {status: 400})
  }

  const octokit = await getInstallationOctokit(artifact.installation_github_id)
  const access = await checkCanAccess(
    octokit,
    {owner: artifact.owner, repo: artifact.repo, username: githubLogin, artifactId: artifact.id},
    {db},
  )
  if (!access.canAccess) {
    return Response.json({error: `user ${githubLogin} is not authorized for artifact ${artifactId}`}, {status: 403})
  }

  const connection = await findDepotConnection(artifact.owner, artifact.repo)
  if (!connection) {
    return Response.json({error: `no depot connection for ${artifact.owner}/${artifact.repo}`}, {status: 404})
  }

  const client = createDepotClientForConnection(connection)
  const download = await client.getArtifactDownloadUrl({artifactId: artifact.depot_artifact_id})
  const upstream = await fetch(download.url)
  if (!upstream.ok || !upstream.body) {
    logger.error('[depot-zip] upstream download failed', {status: upstream.status, artifactId})
    return Response.json({error: `depot download failed: ${upstream.status}`}, {status: 502})
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${artifact.name}.zip"`,
      ...(upstream.headers.get('content-length') && {'content-length': upstream.headers.get('content-length')!}),
    },
  })
}
