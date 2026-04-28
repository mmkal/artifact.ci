import {type PathParams} from './path-params'

export interface ArtifactSummary {
  installationGithubId: number
  artifactId: string
  visibility: string
  entries: string[] | null
}

export interface ArtifactAccessResult {
  canAccess: boolean
  code: string
  reason: string
  isPublic?: boolean
}

export interface ArtifactLoaderParams extends PathParams {
  githubLogin?: string
  artifactId: string
  entry: string | null
}

export type ResolveArtifactRequestResult =
  | {
      code: 'artifact_not_found'
      message: string
      githubLogin?: string
      artifactInfo: null
    }
  | {
      code: 'not_authorized'
      message: string
      params: PathParams
      githubLogin?: string
      access: ArtifactAccessResult
    }
  | {
      code: 'not_uploaded_yet'
      loaderParams: ArtifactLoaderParams
      artifactInfo: ArtifactSummary
    }
  | {
      code: 'upload_not_found'
      message: string
      params: PathParams
      githubLogin?: string
      artifactInfo: ArtifactSummary
      loaderParams: ArtifactLoaderParams
    }
  | {
      code: '2xx'
      storagePathname: string | null
      artifactInfo: ArtifactSummary
      loaderParams: ArtifactLoaderParams
    }

export interface ResolveArtifactRequestDeps {
  findArtifactInfo(params: PathParams & {entry: string | null}): Promise<ArtifactSummary | null>
  checkAccess(input: {
    installationGithubId: number
    artifactId: string
    owner: string
    repo: string
    githubLogin?: string
  }): Promise<ArtifactAccessResult>
  findStoragePathname(input: {artifactId: string; entry: string}): Promise<string | null>
}

export async function resolveArtifactRequest(
  githubLogin: string | null | undefined,
  params: PathParams,
  deps: ResolveArtifactRequestDeps,
): Promise<ResolveArtifactRequestResult> {
  const normalizedGithubLogin = githubLogin || undefined
  const entry = params.filepath?.join('/') || null

  const artifactInfo = await deps.findArtifactInfo({...params, entry})
  if (!artifactInfo) {
    return {
      code: 'artifact_not_found',
      message: `Artifact ${params.artifactName} not found`,
      githubLogin: normalizedGithubLogin,
      artifactInfo,
    }
  }

  const accessResult = await deps.checkAccess({
    installationGithubId: artifactInfo.installationGithubId,
    artifactId: artifactInfo.artifactId,
    owner: params.owner,
    repo: params.repo,
    githubLogin: normalizedGithubLogin,
  })

  if (!accessResult.canAccess) {
    return {
      code: 'not_authorized',
      message: `Not authorized to access artifact ${params.artifactName}`,
      params,
      githubLogin: normalizedGithubLogin,
      access: accessResult,
    }
  }

  const loaderParams: ArtifactLoaderParams = {
    ...params,
    githubLogin: normalizedGithubLogin,
    artifactId: artifactInfo.artifactId,
    entry,
  }

  if (!artifactInfo.entries?.length) {
    return {code: 'not_uploaded_yet', loaderParams, artifactInfo}
  }

  if (!entry) {
    return {code: '2xx', storagePathname: null, artifactInfo, loaderParams}
  }

  const storagePathname = await deps.findStoragePathname({artifactId: artifactInfo.artifactId, entry})
  if (!storagePathname) {
    return {
      code: 'upload_not_found',
      message: 'Upload not found',
      params,
      githubLogin: normalizedGithubLogin,
      artifactInfo,
      loaderParams,
    }
  }

  return {code: '2xx', storagePathname, artifactInfo, loaderParams}
}
