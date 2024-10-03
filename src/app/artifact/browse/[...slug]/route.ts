/* eslint-disable no-console -- let me do basic console logging */
import {Octokit} from '@octokit/rest'
import AdmZip from 'adm-zip'
import {lookup as mimeTypeLookup} from 'mime-types'
import type {NextRequest} from 'next/server'
import {NextResponse} from 'next/server'
import * as path from 'node:path'
import {getGithubAccessToken} from '../../../../auth'
import {logger} from '~/tag-logger'

export const GET = async (request: NextRequest) => {
  try {
    const res = await tryGet(request)
    return res
  } catch (err) {
    logger.error('erroring', err)
    return NextResponse.json({message: 'Internal server error', stack: (err as Error).stack}, {status: 500})
  }
}

const tryGet = async (request: NextRequest) => {
  // if (Math.random()) return NextResponse.json({auth: await auth()})
  const token = await getGithubAccessToken(request)

  if (!token) return NextResponse.json({message: 'Unauthorized - no token'}, {status: 401})

  const pathnamePrefix = request.nextUrl.pathname.match(/^.*\/browse\//)?.[0] || ''
  const [owner, repo, run, artifact, ...rest] = request.nextUrl.pathname.replace(pathnamePrefix, '').split('/')
  const filepath = rest.join('/').replace(/\/$/, '')

  const octokit = new Octokit({auth: token})

  const {data: me} = await octokit.rest.users
    .getAuthenticated()
    .catch(nullify404)
    .catch(error => {
      const e = error as Error & {status?: number; response?: {url: string}}
      if (e.status === 401) {
        throw new Error(`${e.response?.url} ${e.status}: token=${token}`, {cause: e})
      }
      throw e
    })

  if (!me) {
    return NextResponse.json({message: 'Not authenticated with GitHub', tokenStart: token.slice(0, 7)}, {status: 401})
  }

  if (owner !== 'mmkal') {
    return NextResponse.json({message: 'Unauthorized - not mmkal'}, {status: 401})
  }

  const {data: artifacts} = await octokit.rest.actions
    .listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: Number(run),
    })
    .catch(nullify404)

  if (!artifacts) {
    if (token) {
      return new NextResponse(
        `<div>workflow ${run} not found in repo ${owner}/${repo}. You may need to request permissions for this repo. Logged in user: ${me.login}</div>`,
        {status: 404, headers: {'content-type': 'text/html'}},
      )
    }
    const href = `${request.nextUrl.origin}/api/auth/signin?${new URLSearchParams({
      callbackUrl: request.nextUrl.toString(),
    }).toString()}`
    return new NextResponse(
      `
        <div>workflow ${run} not found in repo ${owner}/${repo}. You may need to sign in.</div>
        <a href="${href}">Sign in</a>
      `,
      {status: 404, headers: {'content-type': 'text/html'}},
    )
  }

  const matchedArtifacts = artifacts.artifacts.filter(a => a.name === artifact)

  if (!artifact && artifacts.artifacts.length > 0) {
    return new NextResponse(
      artifacts.artifacts.map(a => `<a href="${request.nextUrl.pathname}/${a.name}">${a.name}</a>`).join('<br/>'),
      {headers: {'content-type': 'text/html'}},
    )
  }

  if (matchedArtifacts.length !== 1) {
    return NextResponse.json(
      {
        message: `Artifact ${artifact} not found`,
        owner,
        repo,
        run,
        artifact,
        path: rest,
        token,
        matchedArtifacts,
        artifacts,
      },
      {status: 404},
    )
  }

  const match = matchedArtifacts[0]

  const zipRes = await fetch(match.archive_download_url, {
    headers: {
      Authorization: `token ${token}`,
    },
  })
  const blob = await zipRes.blob()
  const zip = new AdmZip(Buffer.from(await blob.arrayBuffer()))
  const entries = zip.getEntries()

  if (entries.length === 0) {
    return NextResponse.json(
      {
        entries: zip.getEntries(),
        blob: blob.size,
        status: zipRes.status,
        match,
        headers: Object.fromEntries(zipRes.headers.entries()),
        location: zipRes.headers.get('location'),
        token,
      },
      {status: 404},
    )
  }

  const entryUrl = ({entryName}: {entryName: string}) =>
    request.nextUrl.origin + `${pathnamePrefix}/${owner}/${repo}/${run}/${artifact}/${entryName}`

  const matchedEntry = entries.find(e => e.name && e.entryName === filepath)

  if (!matchedEntry && request.nextUrl.searchParams.get('disable_index_redirect') !== 'true') {
    const matchedIndexFile = entries.find(e => e.name && e.entryName === path.join(filepath, 'index.html'))
    if (matchedIndexFile) {
      return NextResponse.redirect(entryUrl(matchedIndexFile))
    }
  }

  if (matchedEntry) {
    return new NextResponse(matchedEntry.getData(), {
      headers: {
        'content-type': mimeTypeLookup(path.extname(matchedEntry.entryName)) || 'text/plain',
      },
    })
  }

  const files = entries.filter(e => e.entryName.startsWith(filepath))
  files.sort((a, b) => a.entryName.localeCompare(b.entryName))

  return new NextResponse(
    [
      `<title>${match.name} files</title>`,
      `<h1>${match.name} - ${files.filter(e => e.name).length} files under ${filepath || '/'}</h1>`,
      `<body>`,
      ...rest.map((_, i) => {
        const href = entryUrl({entryName: rest.slice(0, i).join('/')})
        return `<a style="display: block" href="${href}/">${'../'.repeat(rest.length - i).slice(0, -1)}</a>`
      }),
      '<div>---</div>',
      ...files.map(
        e =>
          `<div style="margin-left: ${e.entryName.split('/').filter(Boolean).length - 1}em">` +
          `<a href="${entryUrl(e)}">${e.name || e.entryName.split('/').slice(-2).join('/')}</a>` +
          '</div>',
      ),
      '</body>',
    ].join('\n'),
    {
      headers: {
        'content-type': 'text/html',
      },
    },
  )
}

/** Takes an error and returns {data: null} if it's a 404 or rethrows otherwise. */
export const nullify404 = (error: {status?: number} | null): {data: null} => {
  if (error?.status !== 404) throw error as Error
  return {data: null}
}
