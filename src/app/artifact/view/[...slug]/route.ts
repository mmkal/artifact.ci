/* eslint-disable no-console -- let me do basic console logging */
import {lookup as mimeTypeLookup} from 'mime-types'
import {NextResponse} from 'next/server'
import {NextAuthRequest} from 'node_modules/next-auth/lib'
import * as path from 'path'
import {auth, getCollaborationLevel, getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {createStorageClient} from '~/storage/supabase'
import {logger} from '~/tag-logger'

export const ARTIFACT_BLOB_PREFIX = '/artifact/view/'

// sample: http://localhost:3000/artifact/view/mmkal/artifact.ci/11020882214/mocha/output.html
export const GET = auth(async request => {
  try {
    const res = await tryGet(request)
    logger.debug('succeeding', res)
    return res
  } catch (err) {
    logger.error('erroring', err)
    return NextResponse.json({message: 'Internal server error', stack: (err as Error).stack}, {status: 500})
  }
})

const tryGet = async (request: NextAuthRequest) => {
  const callbackUrlPathname = request.nextUrl.toString().replace(request.nextUrl.origin, '')
  const githubLogin = request.auth?.user.github_login

  if (!githubLogin && request.nextUrl.searchParams.get('disable_redirect') === 'true') {
    return NextResponse.json({message: 'Unauthorized - no github login'}, {status: 401})
  }

  if (!githubLogin) {
    const searchParams = new URLSearchParams({callbackUrl: callbackUrlPathname})
    return NextResponse.redirect(`${request.nextUrl.origin}/api/auth/signin?${searchParams}`)
  }

  const pathname = request.nextUrl.pathname.slice(ARTIFACT_BLOB_PREFIX.length)
  const [owner, repo, aliasType, identifier, artifactName, ...filepathParts] = pathname.split('/')

  // const _blobInfo = await client.maybeOne(sql<queries.BlobInfo>`
  //   select
  //     blob_url,
  //     mime_type,
  //     r.owner as repo_owner,
  //     r.name as repo_name,
  //     u.expires_at,
  //     true in (
  //       select true from usage_credits
  //       where github_login = ${githubUser.login}
  //       and expiry > current_timestamp
  //     ) as has_credit,
  //     r.owner = ${githubUser.login} or ${githubUser.login} in (
  //       select rap.github_login
  //       from repo_access_permissions rap
  //       where rap.repo_id = ur.repo_id
  //       and rap.expiry > current_timestamp
  //     ) as already_has_access
  //   from uploads u
  //   join upload_requests ur on ur.id = u.upload_request_id
  //   join repos r on r.id = ur.repo_id
  //   where r.owner = ${owner}
  //   and r.name = ${repo}
  //   and u.pathname = ${pathname}
  // `)

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
    return NextResponse.json(
      {
        message: `Artifact ${artifactName} (from path ${pathname}) not found`,
        details: {artifactName, aliasType, identifier, owner, repo},
        githubUser: githubLogin,
      },

      {status: 404},
    )
  }

  const octokit = await getInstallationOctokit(artifactInfo.installation_github_id)
  const permission = await getCollaborationLevel(octokit, {owner, repo}, githubLogin)

  if (permission === 'none') {
    return NextResponse.json(
      {
        message: `Not authorized to access artifact ${artifactName} (from path ${pathname})`,
        githubUser: githubLogin,
        permission,
      },
      {status: 403},
    )
  }

  if (!artifactInfo.entries?.length) {
    const requestUrl = request.nextUrl
    if (requestUrl.searchParams.get('redirected') === 'true') {
      return NextResponse.json(
        {
          message: `Artifact ${artifactName} (from path ${pathname}) has no entries, probably hasn't been extracted and stored yet`,
          githubUser: githubLogin,
        },
        {status: 404},
      )
    }

    return NextResponse.redirect(
      requestUrl.origin +
        `/artifact/upload?${new URLSearchParams({
          artifactId: artifactInfo.artifact_id,
          artifactName,
          callbackUrl: requestUrl.toString().replace(requestUrl.origin, ''),
        })}`,
    )
  }

  const storage = createStorageClient()
  const dbFile = await client.maybeOne(sql<queries.DbFile>`
    select o.name as storage_pathname
    from artifacts a
    join artifact_entries ae on ae.artifact_id = a.id
    join storage.objects o on ae.storage_object_id = o.id
    where a.id = ${artifactInfo.artifact_id}
    and ${filepathParts.join('/') || 'index'} = any(ae.aliases)
    and o.name is not null
    order by ae.created_at desc
    limit 1
  `)

  if (!dbFile || !dbFile.storage_pathname) {
    return NextResponse.json(
      {
        dbFile,
        message: `Upload for ${pathname} not found`,
        githubUser: githubLogin,
        filepathParts,
        artifactInfo,
      },
      {status: 404},
    )
  }

  const file = await storage.object.bucketName('artifact_files').wildcard(dbFile.storage_pathname).get()

  // const file = await loadFile(pathname)
  if (!file) {
    return NextResponse.json({message: `Upload for ${pathname} not found`, githubUser: githubLogin}, {status: 404})
  }

  const contentType = mimeTypeLookup(dbFile.storage_pathname) || 'text/plain'

  const headers: Record<string, string> = {}

  headers['content-type'] = contentType
  headers['artifactci-path'] = filepathParts.join('/')
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
