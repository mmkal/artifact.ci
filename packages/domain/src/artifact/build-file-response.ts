import {marked} from 'marked'
import {lookup as mimeTypeLookup} from 'mime-types'
import * as path from 'path'
import {type PathParams} from './path-params'

export interface BuildArtifactFileResponseDeps {
  getObjectResponse(storagePathname: string): Promise<Response>
}

export async function buildArtifactFileResponse(
  storagePathname: string,
  params: PathParams,
  deps: BuildArtifactFileResponseDeps,
  options?: {raw?: boolean},
) {
  const response = await deps.getObjectResponse(storagePathname)
  const ext = path.extname(storagePathname).toLowerCase()

  if ((ext === '.md' || ext === '.markdown') && !options?.raw) {
    const markdown = await response.text()
    const htmlContent = await marked.parse(markdown)
    const filename = path.basename(storagePathname)
    const headers = buildArtifactHeaders(response, storagePathname, params)

    headers['content-type'] = 'text/html; charset=utf-8'
    headers['content-disposition'] = `inline; filename="${encodeURIComponent(filename.replace(/\.md$/, '.html'))}"`

    return new Response(renderMarkdownPage(htmlContent, filename), {headers, status: 200})
  }

  const headers = buildArtifactHeaders(response, storagePathname, params)

  if (headers['content-type']?.startsWith('text/plain')) {
    return new Response(await response.text(), {headers, status: response.status})
  }

  return new Response(response.body, {headers, status: response.status})
}

function buildArtifactHeaders(response: Response, storagePathname: string, params: PathParams) {
  const ext = path.extname(storagePathname).toLowerCase()
  let contentType = mimeTypeLookup(storagePathname) || 'text/plain'
  if (ext === '.log') {
    contentType = 'text/plain'
  }

  const headers: Record<string, string> = {
    'content-type': contentType,
    'artifactci-path': (params.filepath || []).join('/'),
    'artifactci-name': params.artifactName,
    'artifactci-identifier': params.identifier,
    'artifactci-alias-type': params.aliasType,
  }

  for (const header of ['content-length', 'etag', 'last-modified']) {
    const value = response.headers.get(header)
    if (value) headers[header] = value
  }

  if (shouldInline(ext, contentType)) {
    headers['content-disposition'] = `inline; filename="${encodeURIComponent(path.basename(storagePathname))}"`
  }

  if (params.aliasType === 'branch') {
    headers['cache-control'] = 'public, max-age=300, must-revalidate'
  } else if (params.aliasType === 'run' || params.aliasType === 'sha') {
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = response.headers.get('cache-control') || 'no-cache'
  }

  return headers
}

function shouldInline(ext: string, contentType: string) {
  return (
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
    ext === '.jsonl' ||
    contentType.startsWith('text/') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('audio/')
  )
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
