export interface RequestSessionSnapshot {
  githubLogin?: string
}

export const getRequestSession = async (request: Request): Promise<RequestSessionSnapshot> => {
  const headerLogin = request.headers.get('x-artifact-github-login')?.trim()
  if (headerLogin) {
    return {githubLogin: headerLogin}
  }

  const cookieLogin = getCookie(request.headers.get('cookie') || '', 'artifact_github_login')
  if (cookieLogin) {
    return {githubLogin: decodeURIComponent(cookieLogin)}
  }

  return {}
}

function getCookie(cookieHeader: string, name: string) {
  for (const entry of cookieHeader.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) {
      return value.join('=')
    }
  }

  return undefined
}
