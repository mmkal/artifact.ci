/* eslint-disable no-console -- let me do basic console logging */
import {Octokit} from '@octokit/rest'
import {lookup as mimeTypeLookup} from 'mime-types'
import type {NextRequest} from 'next/server'
import {NextResponse} from 'next/server'
import {getGithubAccessToken} from '../../../../auth'
import {client, sql} from '~/db'
import {loadFile} from '~/storage/supabase'

export const ARTIFACT_BLOB_PREFIX = '/artifact/view/'

// sample: http://localhost:3000/artifact/view/mmkal/artifact.ci/11020882214/mocha/output.html
export const GET = async (request: NextRequest) => {
  try {
    const res = await tryGet(request)
    console.log('succeeding', res)
    return res
  } catch (err) {
    console.error('erroring', err)
    return NextResponse.json({message: 'Internal server error', stack: (err as Error).stack}, {status: 500})
  }
}

const tryGet = async (request: NextRequest) => {
  const callbackUrlPathname = request.nextUrl.toString().replace(request.nextUrl.origin, '')
  const token = await getGithubAccessToken(request)

  if (!token && request.nextUrl.searchParams.get('disable_redirect') === 'true') {
    return NextResponse.json({message: 'Unauthorized - no token'}, {status: 401})
  }

  if (!token) {
    const searchParams = new URLSearchParams({callbackUrl: callbackUrlPathname})
    return NextResponse.redirect(`${request.nextUrl.origin}/api/auth/signin?${searchParams}`)
  }

  const octokit = new Octokit({auth: token, log: console})

  const redactedToken = `${token.slice(0, 7)}...${token.slice(-5)}`
  console.log('token', redactedToken)

  const {data: githubUser} = await octokit.rest.users.getAuthenticated().catch(nullify404)

  if (!githubUser) {
    return NextResponse.json({message: 'Not authenticated with GitHub', token: redactedToken}, {status: 401})
  }

  const pathname = request.nextUrl.pathname.slice(ARTIFACT_BLOB_PREFIX.length)

  if (pathname) {
    const file = await loadFile(pathname)
    if (!file) {
      return NextResponse.json(
        {message: `Upload for ${pathname} not found`, githubUser: githubUser.login},
        {status: 404},
      )
    }
    return new NextResponse(file.object.response.body, {
      headers: {
        'content-type': mimeTypeLookup(file.pathname) || 'text/plain',
      },
    })
  }

  const [owner, repo] = pathname.split('/')

  const blobInfo = await client.maybeOne(sql<queries.BlobInfo>`
    select
      blob_url,
      mime_type,
      r.owner as repo_owner,
      r.name as repo_name,
      u.expires_at,
      true in (
        select true from usage_credits
        where github_login = ${githubUser.login}
        and expiry > current_timestamp
      ) as has_credit,
      r.owner = ${githubUser.login} or ${githubUser.login} in (
        select rap.github_login
        from repo_access_permissions rap
        where rap.repo_id = ur.repo_id
        and rap.expiry > current_timestamp
      ) as already_has_access
    from uploads u
    join upload_requests ur on ur.id = u.upload_request_id
    join repos r on r.id = ur.repo_id
    where r.owner = ${owner}
    and r.name = ${repo}
    and u.pathname = ${pathname}
  `)

  if (!blobInfo) {
    return NextResponse.json(
      {message: `Upload for ${pathname} not found`, githubUser: githubUser.login, owner, repo},
      {status: 404},
    )
  }

  if (!blobInfo.has_credit) {
    return NextResponse.json(
      {
        message: `Unauthorized - username ${githubUser.login} has no credit`,
        signoutUrl: `${request.nextUrl.origin}/api/auth/signout?${new URLSearchParams({
          callbackUrl: callbackUrlPathname,
        })}`,
      },
      {status: 401},
    )
  }

  let hasAccess = blobInfo.already_has_access
  if (!hasAccess) {
    const {data: branches} = await octokit.rest.repos.listBranches({owner, repo, per_page: 1}).catch(nullify404)
    console.log(`Should ${githubUser.login} get access to ${owner}/${repo}? Answer: ${!!branches}`)
    if (branches) {
      await client.query(sql<queries.RepoAccessPermission>`
        insert into repo_access_permissions (repo_id, github_login, expiry)
        select r.id, ${githubUser.login}, current_timestamp + interval '24 hours'
        from repos r
        where r.owner = ${owner}
        and r.name = ${repo}
        on conflict (repo_id, github_login)
        do update set expiry = excluded.expiry
        returning true
      `)
      hasAccess = true
    }
  }

  if (!blobInfo.expires_at?.toISOString) {
    console.warn(`expires_at is not a valid date?`, blobInfo)
    blobInfo.expires_at = new Date(blobInfo.expires_at)
  }
  if (blobInfo.expires_at < new Date()) {
    return NextResponse.json(
      {message: `Artifact ${pathname} expired at ${blobInfo.expires_at.toISOString()}`},
      {status: 410},
    )
  }

  const storageOrigin = process.env.STORAGE_ORIGIN
  if (!storageOrigin) {
    throw new Error('STORAGE_ORIGIN environment variable is not set')
  }

  const targetUrl = blobInfo.blob_url
  const storageResponse = await fetch(targetUrl)

  if (storageResponse.headers.get('x-matched-path') === '/docs/storage/vercel-blob/blocked-store') {
    const message = `Failed to fetch blob at ${targetUrl.toString()}.`
    return NextResponse.json(
      {message, reason: `The upstream storage service has reached its limit.`}, //
      {status: 503},
    )
  }

  if (!storageResponse.ok) {
    return NextResponse.json(
      {message: 'Failed to fetch blob at ' + targetUrl.toString()},
      {status: storageResponse.status},
    )
  }

  const mimeType = mimeTypeLookup(targetUrl) || 'text/plain'

  const headers = new Headers({} || storageResponse.headers)
  headers.set('Content-Type', mimeType)
  headers.delete('Content-Disposition') // rely on default browser behavior
  headers.delete('Content-Security-Policy') // be careful!
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('x-storage-location', targetUrl)

  return new NextResponse(storageResponse.body, {
    status: storageResponse.status,
    statusText: storageResponse.statusText,
    headers,
  })
}

/** Takes an error and returns {data: null} if it's a 404 or rethrows otherwise. */
export const nullify404 = (error: {status?: number} | null): {data: null} => {
  if (error?.status !== 404) throw error as Error
  return {data: null}
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select blob_url, mime_type, r.owner as r... [truncated] ...= $4 and r.name = $5 and u.pathname = $6` */
  export interface BlobInfo {
    /** column: `public.uploads.blob_url`, not null: `true`, regtype: `text` */
    blob_url: string

    /** column: `public.uploads.mime_type`, not null: `true`, regtype: `text` */
    mime_type: string

    /** column: `public.repos.owner`, not null: `true`, regtype: `text` */
    repo_owner: string

    /** column: `public.repos.name`, not null: `true`, regtype: `text` */
    repo_name: string

    /** column: `public.uploads.expires_at`, not null: `true`, regtype: `timestamp with time zone` */
    expires_at: Date

    /** regtype: `boolean` */
    has_credit: boolean | null

    /** regtype: `boolean` */
    already_has_access: boolean | null
  }

  /** - query: `insert into repo_access_permissions (rep... [truncated] ... expiry = excluded.expiry returning true` */
  export interface RepoAccessPermission {
    /** regtype: `boolean` */
    '?column?': boolean | null
  }
}
