import {lookup as mimeTypeLookup} from 'mime-types'
import {cookies} from 'next/headers'
import {NextResponse} from 'next/server'
import {NextAuthRequest} from 'node_modules/next-auth/lib'
import * as path from 'path'
import {ArtifactUploadPageSearchParams} from '~/app/artifact/upload/page'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
import {auth, getCollaborationLevel, getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {createStorageClient} from '~/storage/supabase'
import {logger} from '~/tag-logger'

export type PathParams = {
  owner: string
  repo: string
  aliasType: string
  identifier: string
  artifactName: string
  filepath: string[]
}

// sample: http://localhost:3000/artifact/view/mmkal/artifact.ci/11020882214/mocha/output.html
export const GET = auth(async (request, {params}) => {
  return logger
    .try('request', () => tryGet(request, {params: params as PathParams}))
    .catch(error => {
      logger.error(error)
      return NextResponse.json({message: 'Internal server error'}, {status: 500})
    })
})

const tryGet = async (request: NextAuthRequest, {params}: {params: PathParams}) => {
  logger.tag('params').debug(params)
  const {owner, repo, aliasType, identifier, artifactName, filepath} = params
  const callbackUrlPathname = request.nextUrl.toString().replace(request.nextUrl.origin, '')
  const githubLogin = request.auth?.user.github_login

  if (!githubLogin && request.nextUrl.searchParams.get('disable_redirect') === 'true') {
    return NextResponse.json({message: 'Unauthorized - no github login'}, {status: 401})
  }

  if (!githubLogin) {
    const searchParams = new URLSearchParams({callbackUrl: callbackUrlPathname})
    return NextResponse.redirect(`${request.nextUrl.origin}/api/auth/signin?${searchParams}`)
  }

  const artifactInfo = await client.maybeOne(sql<queries.ArtifactInfo>`
    select
      i.github_id as installation_github_id,
      a.id as artifact_id,
      a.download_url,
      (select array_agg(entry_name) from artifact_entries ae where ae.artifact_id = a.id) entries
    from artifacts a
    join artifact_identifiers aid on aid.artifact_id = a.id
    join github_installations i on i.id = a.installation_id
    join repos r on r.id = a.repo_id
    where a.name = ${artifactName}
    and aid.type = ${aliasType}
    and aid.value = ${identifier}
    and r.owner = ${owner}
    and r.name = ${repo}
  `)

  if (!artifactInfo) {
    const message = `Artifact ${artifactName} not found`
    return NextResponse.json({message, params, githubUser: githubLogin}, {status: 404})
  }

  const octokit = await getInstallationOctokit(artifactInfo.installation_github_id)
  const permission = await getCollaborationLevel(octokit, {owner, repo}, githubLogin)

  if (permission === 'none') {
    const message = `Not authorized to access artifact ${artifactName}`
    return NextResponse.json({message, params, githubLogin, permission}, {status: 403})
  }

  const requestUrl = request.nextUrl
  if (!artifactInfo.entries?.length) {
    const cookieName = 'redirected'
    const cookieStore = cookies()

    if (cookieStore.get(cookieName)) {
      const message = `Artifact ${artifactName} has no entries, probably hasn't been extracted and stored yet`
      return NextResponse.json({message, params, githubLogin}, {status: 404})
    }

    const uploadPageParams: ArtifactUploadPageSearchParams = {
      ...params,
      artifactId: artifactInfo.artifact_id,
      entry: filepath.join('/'),
    }

    const response = NextResponse.redirect(
      requestUrl.origin + `/artifact/upload?${new URLSearchParams(uploadPageParams)}`,
    )
    response.cookies.set({name: cookieName, value: 'true', path: request.nextUrl.pathname, maxAge: 120})

    return response
  }

  if (filepath.length === 0) {
    // for now, redirect to the calculated entrypoint, but maybe this should be a file-selector UI or something
    const {entrypoints} = getEntrypoints(artifactInfo.entries)
    const newUrl = new URL(requestUrl.origin + requestUrl.pathname + '/' + entrypoints[0])
    return NextResponse.redirect(newUrl)
  }

  const storage = createStorageClient()
  const dbFile = await client.maybeOne(sql<queries.DbFile>`
    select o.name as storage_pathname
    from artifacts a
    join artifact_entries ae on ae.artifact_id = a.id
    join storage.objects o on ae.storage_object_id = o.id
    where a.id = ${artifactInfo.artifact_id}
    and ${filepath.join('/') || '.'} = any(ae.aliases)
    and o.name is not null
    order by ae.created_at desc
    limit 1
  `)

  if (!dbFile || !dbFile.storage_pathname) {
    return NextResponse.json({dbFile, message: `Upload not found`, params, githubLogin, artifactInfo}, {status: 404})
  }

  const file = await storage.object.bucketName('artifact_files').wildcard(dbFile.storage_pathname).get()

  if (!file) {
    return NextResponse.json({message: `Upload not found`, params, githubLogin}, {status: 404})
  }

  const contentType = mimeTypeLookup(dbFile.storage_pathname) || 'text/plain'

  const headers: Record<string, string> = {}

  headers['content-type'] = contentType
  headers['artifactci-path'] = filepath.join('/')
  headers['artifactci-name'] = artifactName
  headers['artifactci-identifier'] = identifier
  headers['artifactci-alias-type'] = aliasType

  // Add relevant headers from the object response
  const relevantHeaders = ['content-length', 'etag', 'last-modified']
  for (const header of relevantHeaders) {
    const value = file.response.headers.get(header)
    if (value) headers[header] = value
  }

  const ext = path.extname(dbFile.storage_pathname)
  if (
    ext === '.html' ||
    ext === '.htm' ||
    ext === '.json' ||
    ext === '.pdf' ||
    ext === '.txt' ||
    contentType.startsWith('text/') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  ) {
    headers['content-disposition'] = `inline; filename="${encodeURIComponent(path.basename(dbFile.storage_pathname))}"`
  }

  if (aliasType === 'branch') {
    headers['cache-control'] = 'public, max-age=300, must-revalidate'
  } else if (aliasType === 'run' || aliasType === 'sha') {
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = file.response.headers.get('cache-control') || 'no-cache'
  }

  return new Response(file.response.body, {headers, status: file.response.status})
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select i.github_id as installation_githu... [truncated] ...ue = $3 and r.owner = $4 and r.name = $5` */
  export interface ArtifactInfo {
    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    installation_github_id: number

    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    artifact_id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.download_url`, not null: `true`, regtype: `text` */
    download_url: string

    /**
     * From CTE subquery "subquery_3_for_column_entries"
     *
     * column: `✨.subquery_3_for_column_entries.entries`, regtype: `text[]`
     */
    entries: string[] | null
  }

  /** - query: `select o.name as storage_pathname from a... [truncated] ...null order by ae.created_at desc limit 1` */
  export interface DbFile {
    /** column: `storage.objects.name`, regtype: `text` */
    storage_pathname: string | null
  }
}
