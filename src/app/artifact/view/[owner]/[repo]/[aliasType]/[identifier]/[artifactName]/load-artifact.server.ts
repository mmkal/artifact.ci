import {marked} from 'marked'
import {lookup as mimeTypeLookup} from 'mime-types'
import * as path from 'path'
import {type ArtifactLoader} from './ArtifactLoader'
import {type PathParams} from '~/app/artifact/view/params'
import {checkCanAccess, getInstallationOctokit} from '~/auth'
import {client, sql} from '~/db'
import {supabaseStorageServiceRoleClient} from '~/storage/supabase'
import {logger} from '~/tag-logger'

export const loadArtifact = async (login: string | null | undefined, {params}: {params: PathParams}) => {
  const githubLogin = login || undefined
  logger.tag('params').debug(params)
  const {owner, repo, aliasType, identifier, artifactName, filepath = []} = params

  const artifactInfo = await client.maybeOne(sql<queries.ArtifactInfo>`
    select
      i.github_id as installation_github_id,
      a.id as artifact_id,
      a.visibility,
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
    return {code: 'artifact_not_found', message, githubLogin, artifactInfo} as const
  }

  const octokit = await getInstallationOctokit(artifactInfo.installation_github_id)
  const accessResult = await checkCanAccess(octokit, {
    owner,
    repo,
    username: githubLogin,
    artifactId: artifactInfo.artifact_id,
  })

  if (!accessResult.canAccess) {
    const message = `Not authorized to access artifact ${artifactName}`
    return {code: 'not_authorized', message, params, githubLogin, access: accessResult} as const
  }

  const loaderParams: ArtifactLoader.Params = {
    ...params,
    githubLogin,
    artifactId: artifactInfo.artifact_id,
    entry: filepath.join('/') || null,
  }

  if (!artifactInfo.entries?.length) {
    return {code: 'not_uploaded_yet', loaderParams, artifactInfo} as const
  }

  if (filepath.length === 0) {
    return {code: '2xx', storagePathname: null, artifactInfo, loaderParams} as const
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
    return {
      code: 'upload_not_found',
      message: `Upload not found`,
      params,
      githubLogin,
      artifactInfo,
      loaderParams,
    } as const
  }

  return {code: '2xx', storagePathname: dbFile.storage_pathname, artifactInfo, loaderParams} as const
}

export async function loadFile(storagePathname: string, params: PathParams, options?: {raw?: boolean}) {
  const storage = supabaseStorageServiceRoleClient()
  const file = await storage.object.bucketName('artifact_files').wildcard(storagePathname).get()

  const ext = path.extname(storagePathname).toLowerCase()

  if ((ext === '.md' || ext === '.markdown') && !options?.raw) {
    const markdown = await file.response.text()
    const htmlContent = await marked.parse(markdown)
    const filename = path.basename(storagePathname)

    const html = renderMarkdownPage(htmlContent, filename)

    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      'artifactci-path': (params.filepath || []).join('/'),
      'artifactci-name': params.artifactName,
      'artifactci-identifier': params.identifier,
      'artifactci-alias-type': params.aliasType,
      'content-disposition': `inline; filename="${encodeURIComponent(filename.replace(/\.md$/, '.html'))}"`,
    }

    if (params.aliasType === 'branch') {
      headers['cache-control'] = 'public, max-age=300, must-revalidate'
    } else if (params.aliasType === 'run' || params.aliasType === 'sha') {
      headers['cache-control'] = 'public, max-age=31536000, immutable'
    }

    return new Response(html, {headers, status: 200})
  }

  let contentType = mimeTypeLookup(storagePathname) || 'text/plain'
  if (ext === '.log') {
    contentType = 'text/plain'
  }

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

  if (
    ext === '.html' ||
    ext === '.htm' ||
    ext === '.json' ||
    ext === '.pdf' ||
    ext === '.txt' ||
    ext === '.log' ||
    ext === '.csv' ||
    ext === '.tsv' ||
    ext === '.xml' ||
    ext === '.yaml' ||
    ext === '.yml' ||
    ext === '.json' ||
    ext === '.jsonl' ||
    ext === '.jsonl' ||
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

function renderMarkdownPage(htmlContent: string, filename: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(filename)}</title>
      <style>
        :root {
          --bg: #0f172a;
          --text: rgba(251, 191, 36, 0.8);
          --text-bright: #fbbf24;
          --border: rgba(251, 191, 36, 0.3);
          --link: #60a5fa;
          --code-bg: rgba(0, 0, 0, 0.3);
          --blockquote-border: rgba(251, 191, 36, 0.5);
        }
        * { box-sizing: border-box; }
        body {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
          background: var(--bg);
          color: var(--text);
          line-height: 1.6;
          margin: 0;
          padding: 2rem;
          max-width: 900px;
          margin: 0 auto;
        }
        h1, h2, h3, h4, h5, h6 {
          color: var(--text-bright);
          border-bottom: 1px solid var(--border);
          padding-bottom: 0.3em;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        a { color: var(--link); text-decoration: none; }
        a:hover { text-decoration: underline; }
        code {
          background: var(--code-bg);
          padding: 0.2em 0.4em;
          border-radius: 4px;
          font-size: 0.9em;
        }
        pre {
          background: var(--code-bg);
          padding: 1em;
          border-radius: 6px;
          overflow-x: auto;
          border: 1px solid var(--border);
        }
        pre code {
          background: none;
          padding: 0;
        }
        blockquote {
          border-left: 4px solid var(--blockquote-border);
          margin: 1em 0;
          padding: 0.5em 1em;
          background: var(--code-bg);
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
        }
        th, td {
          border: 1px solid var(--border);
          padding: 0.5em 1em;
          text-align: left;
        }
        th { background: var(--code-bg); color: var(--text-bright); }
        img { max-width: 100%; height: auto; border-radius: 4px; }
        ul, ol { padding-left: 1.5em; }
        li { margin: 0.25em 0; }
        hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 2em 0;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8em;
          color: var(--text);
          opacity: 0.6;
          margin-bottom: 1em;
          padding-bottom: 0.5em;
          border-bottom: 1px solid var(--border);
        }
        .raw-link { opacity: 0.8; }
        .raw-link:hover { opacity: 1; }
      </style>
    </head>
    <body>
      <div class="header">
        <span>${escapeHtml(filename)}</span>
        <a href="?raw=true" class="raw-link">show raw</a>
      </div>
      <article>${htmlContent}</article>
    </body>
    </html>
  `
}

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export declare namespace queries {
  // Generated by @pgkit/typegen

  /** - query: `select i.github_id as installation_githu... [truncated] ... = $5 order by a.created_at desc limit 1` */
  export interface ArtifactInfo {
    /** column: `public.github_installations.github_id`, not null: `true`, regtype: `bigint` */
    installation_github_id: number

    /** column: `public.artifacts.id`, not null: `true`, regtype: `prefixed_ksuid` */
    artifact_id: import('~/db').Id<'artifacts'>

    /** column: `public.artifacts.visibility`, not null: `true`, regtype: `text` */
    visibility: string

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
