export const ARTIFACT_BLOB_PREFIX = '/artifact/view/'
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace artifactUrl {
  export interface Parts {
    origin: string
    owner: string
    repo: string
    aliasType: 'run' | 'sha' | 'branch' | 'tag'
    /** e.g. `${runId}.${runAttempt}` or `${sha}` or `${branchName}` or `${tagName}` */
    identifier: string
    artifactName: string
    filepath: string
  }
}
export const artifactUrl = {
  create: (params: artifactUrl.Parts) => {
    return `${params.origin}${ARTIFACT_BLOB_PREFIX}${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}`
  },
  parse: (url: string): artifactUrl.Parts => {
    const {origin, pathname} = new URL(url)
    if (pathname.startsWith(ARTIFACT_BLOB_PREFIX)) {
      throw new Error(
        `Invalid artifact URL, expected pathname to start with ${ARTIFACT_BLOB_PREFIX} but got ${pathname}`,
      )
    }
    const [owner, repo, aliasType, identifier, artifactName, ...rest] = pathname
      .slice(ARTIFACT_BLOB_PREFIX.length)
      .split('/')
    if (aliasType !== 'run' && aliasType !== 'sha' && aliasType !== 'branch' && aliasType !== 'tag') {
      throw new Error(`Invalid alias type, expected 'run' | 'sha' | 'branch' | 'tag' but got ${aliasType}`)
    }

    return {origin, owner, repo, aliasType, identifier, artifactName, filepath: rest.join('/')}
  },
}
