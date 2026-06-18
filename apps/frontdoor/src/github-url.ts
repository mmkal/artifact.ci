const GITHUB_HOST = 'github.com'
const ARTIFACT_VIEW_PREFIX = '/artifact/view'

export function getGithubUrlRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const requestUrl = new URL(request.url)
  const githubUrl = parseGithubUrlFromArtifactUrl(requestUrl)
  if (!githubUrl) return null

  const path = toArtifactPath(githubUrl)
  if (!path) return null

  return Response.redirect(new URL(path, requestUrl.origin), 302)
}

function parseGithubUrlFromArtifactUrl(requestUrl: URL): URL | null {
  const rawPath = requestUrl.pathname.slice(1)
  if (!rawPath) return null

  const rawCandidate =
    rawPath.startsWith('https://') || rawPath.startsWith('http://') ? `${rawPath}${requestUrl.search}` : rawPath
  const decodedCandidate = safeDecodeURIComponent(rawCandidate)

  for (const candidate of normalizeGithubUrlCandidates([rawCandidate, decodedCandidate])) {
    if (!candidate) continue
    const url = safeParseUrl(candidate)
    if (url?.hostname === GITHUB_HOST) return url
  }

  return null
}

function normalizeGithubUrlCandidates(candidates: Array<string | null>) {
  const normalized: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    normalized.push(candidate)
    if (candidate.startsWith('https:/github.com/')) normalized.push(candidate.replace('https:/', 'https://'))
    if (candidate.startsWith('http:/github.com/')) normalized.push(candidate.replace('http:/', 'http://'))
  }
  return normalized
}

function toArtifactPath(githubUrl: URL): string | null {
  const parts = githubUrl.pathname.split('/').filter(Boolean)
  const [owner, repo, segment, type, value] = parts
  if (!owner || !repo) return null

  if (segment === 'actions' && type === 'runs' && value && /^\d+$/.test(value)) {
    return [ARTIFACT_VIEW_PREFIX, owner, repo, 'run', value].map(encodePathSegment).join('/')
  }

  if (segment === 'pull' && type && /^\d+$/.test(type)) {
    return [ARTIFACT_VIEW_PREFIX, owner, repo, 'pr', type].map(encodePathSegment).join('/')
  }

  return null
}

function encodePathSegment(segment: string) {
  return segment
    .split('/')
    .map(value => encodeURIComponent(value))
    .join('/')
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
