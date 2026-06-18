import {type PathParams} from './path-params'

export interface ArtifactSummary {
  installationGithubId: number
  artifactId: string
  visibility: string
  entries: string[] | null
}

// Why we couldn't find a row for the requested artifact. Used to give the
// user (and the UI) a specific message + offer the right next step (install
// the GitHub App, fetch the artifact on demand, etc.) instead of a generic
// "not found".
export type MissingDiagnostic =
  | {kind: 'repo_not_registered'; owner: string; repo: string}
  | {kind: 'no_artifact_in_repo'; owner: string; repo: string; artifactName: string}
  | {
      kind: 'no_identifier_for_artifact'
      owner: string
      repo: string
      artifactName: string
      aliasType: string
      identifier: string
    }
  | {kind: 'unknown'}

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
      missing: MissingDiagnostic
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
  // Called only when findArtifactInfo returns null, to drill down on which
  // row was missing (repo / artifact / identifier) so the UI can show a
  // specific message + the right call-to-action.
  //
  // Implementations MUST gate any kind that confirms the repo exists in our
  // DB (i.e. anything other than 'repo_not_registered' / 'unknown') behind a
  // GitHub-level access check — otherwise hitting an arbitrary URL would
  // reveal the existence of private repos to outsiders.
  diagnoseMissingArtifact(params: PathParams, githubLogin: string | undefined): Promise<MissingDiagnostic>
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
    const missing = await deps.diagnoseMissingArtifact(params, normalizedGithubLogin)
    return {
      code: 'artifact_not_found',
      message: `Artifact ${params.artifactName} not found`,
      githubLogin: normalizedGithubLogin,
      artifactInfo,
      missing,
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
