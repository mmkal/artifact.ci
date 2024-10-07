import {lookup as mimeTypeLookup} from 'mime-types'
import {cookies} from 'next/headers'
import * as path from 'path'
import {type ArtifactLoader} from './loader'
import {type PathParams} from '~/app/artifact/view/params'
import {getCollaborationLevel, getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {supabaseStorageServiceRoleClient} from '~/storage/supabase'
import {logger} from '~/tag-logger'

const ResponseHelpers = {
  json: <const T>(body: T, options: {status: 400 | 401 | 403 | 404}) => ({outcome: '4xx', body, options}) as const,
}

export const loadArtifact = async (githubLogin: string, {params}: {params: PathParams}) => {
  logger.tag('params').debug(params)
  const {owner, repo, aliasType, identifier, artifactName, filepath = []} = params

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
    order by a.created_at desc
    limit 1
  `)

  if (!artifactInfo) {
    const message = `Artifact ${artifactName} not found`
    return ResponseHelpers.json({message, params, githubUser: githubLogin}, {status: 404})
  }

  const octokit = await getInstallationOctokit(artifactInfo.installation_github_id)
  const permission = await getCollaborationLevel(octokit, {owner, repo, username: githubLogin})

  if (permission === 'none') {
    const message = `Not authorized to access artifact ${artifactName}`
    return ResponseHelpers.json({message, params, githubLogin, permission}, {status: 403})
  }

  const loaderParams: ArtifactLoader.Params = {
    ...params,
    githubLogin,
    artifactId: artifactInfo.artifact_id,
    entry: filepath.join('/') || null,
  }

  if (!artifactInfo.entries?.length) {
    const cookieName = 'redirected'
    const cookieStore = cookies()

    if (cookieStore.get(cookieName)) {
      const message = `Artifact ${artifactName} has no entries, probably hasn't been extracted and stored yet`
      return ResponseHelpers.json({message, params, githubLogin}, {status: 404})
    }

    return {outcome: 'not_uploaded_yet', loaderParams, artifactInfo} as const
  }

  if (filepath.length === 0) {
    return {outcome: '2xx', storagePathname: null, artifactInfo, loaderParams} as const
  }

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
    return ResponseHelpers.json({dbFile, message: `Upload not found`, params, githubLogin, artifactInfo}, {status: 404})
  }

  return {outcome: '2xx', storagePathname: dbFile.storage_pathname, artifactInfo, loaderParams} as const
}

export async function loadFile(storagePathname: string, params: PathParams) {
  const storage = supabaseStorageServiceRoleClient()
  const file = await storage.object.bucketName('artifact_files').wildcard(storagePathname).get()

  const contentType = mimeTypeLookup(storagePathname) || 'text/plain'

  const headers: Record<string, string> = {}

  headers['content-type'] = contentType
  headers['artifactci-path'] = (params.filepath || []).join('/')
  headers['artifactci-name'] = params.artifactName
  headers['artifactci-identifier'] = params.identifier
  headers['artifactci-alias-type'] = params.aliasType

  // Add relevant headers from the object response
  const relevantHeaders = ['content-length', 'etag', 'last-modified']
  for (const header of relevantHeaders) {
    const value = file.response.headers.get(header)
    if (value) headers[header] = value
  }

  const ext = path.extname(storagePathname)
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
    headers['content-disposition'] = `inline; filename="${encodeURIComponent(path.basename(storagePathname))}"`
  }

  if (params.aliasType === 'branch') {
    headers['cache-control'] = 'public, max-age=300, must-revalidate'
  } else if (params.aliasType === 'run' || params.aliasType === 'sha') {
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = file.response.headers.get('cache-control') || 'no-cache'
  }

  return new Response(file.response.body, {headers, status: file.response.status})
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select i.github_id as installation_githu... [truncated] ... = $5 order by a.created_at desc limit 1` */
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
