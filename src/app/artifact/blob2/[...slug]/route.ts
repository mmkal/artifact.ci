/* eslint-disable no-console -- let me do basic console logging */
import {Octokit} from '@octokit/rest'
import {lookup as mimeTypeLookup} from 'mime-types'
import type {NextRequest} from 'next/server'
import {NextResponse} from 'next/server'
import {getGithubAccessToken} from '../../../../auth'
import {client, sql} from '~/db'

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
  // if (Math.random()) return NextResponse.json({auth: await auth()})
  const token = await getGithubAccessToken(request)

  if (!token) return NextResponse.json({message: 'Unauthorized - no token'}, {status: 401})

  const octokit = new Octokit({auth: token, log: console})

  const {data: githubUser} = await octokit.rest.users
    .getAuthenticated()
    .catch(nullify404)
    .catch(error => {
      const e = error as Error & {status?: number; response?: {url: string}}
      if (e.status === 401) {
        throw new Error(`${e.response?.url} ${e.status}: token=${token}`, {cause: e})
      }
      throw e
    })

  if (!githubUser) {
    return NextResponse.json({message: 'Not authenticated with GitHub', tokenStart: token.slice(0, 7)}, {status: 401})
  }
  const artifactBlobPrefix = '/artifact/blob2/'
  const pathname = request.nextUrl.pathname.slice(artifactBlobPrefix.length)

  const hasCredit = await client.maybeOne(sql`
    select 1
    from usage_credits
    where github_login = ${githubUser.login}
    and expiry > current_timestamp
  `)

  if (!hasCredit) {
    return NextResponse.json({message: `Unauthorized - username ${githubUser.login} has no credit`}, {status: 401})
  }

  const storageOrigin = process.env.STORAGE_ORIGIN
  if (!storageOrigin) {
    throw new Error('STORAGE_ORIGIN environment variable is not set')
  }

  const targetUrl = new URL(pathname, storageOrigin)

  let storageResponse = await fetch(targetUrl)

  if (storageResponse.status === 404) {
    // if 404, try serving `/index.html`
    storageResponse = await fetch(targetUrl.toString().replace(/\/?$/, '/index.html'))
  }

  if (!storageResponse.ok) {
    return NextResponse.json({message: 'Failed to fetch blob at ' + targetUrl}, {status: storageResponse.status})
  }

  const mimeType = mimeTypeLookup(pathname) || 'text/plain'

  const headers = new Headers(storageResponse.headers)
  headers.set('Content-Type', mimeType)
  headers.delete('Content-Disposition') // rely on default browser behavior
  headers.delete('Content-Security-Policy') // be careful!
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new NextResponse(storageResponse.body, {
    status: storageResponse.status,
    statusText: storageResponse.statusText,
    headers: headers,
  })
}

/** Takes an error and returns {data: null} if it's a 404 or rethrows otherwise. */
export const nullify404 = (error: {status?: number} | null): {data: null} => {
  if (error?.status !== 404) throw error as Error
  return {data: null}
}
