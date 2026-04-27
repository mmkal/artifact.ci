import {toAppArtifactPath} from '@artifact/domain/artifact/path-params'
import type {ArtifactResult, ListResponse, RepoResult} from '../artifacts/search'

const toViewPath = (params: {owner?: string; repo?: string; aliasType?: string; identifier?: string}) => {
  const segments = ['/artifact/view']
  for (const k of ['owner', 'repo', 'aliasType', 'identifier'] as const) {
    const v = params[k]
    if (!v) break
    segments.push(encodeURIComponent(v))
  }
  return segments.join('/')
}

export function RepoList({data}: {data: ListResponse<RepoResult>}) {
  if (data.code === 'not_logged_in') {
    return (
      <div className="search__empty">
        Not signed in. <a href="/login" className="search__link">Sign in</a> to see repositories the dev app can access.
      </div>
    )
  }
  if (data.code === 'no_access') {
    return (
      <div className="search__empty">
        The GitHub App can&apos;t confirm access for this owner. Make sure{' '}
        <a href="https://github.com/apps/artifact-ci" rel="noreferrer noopener" target="_blank">the app</a>
        {' '}is installed on the repositories you want to list.
      </div>
    )
  }
  if (data.results.length === 0) {
    return <div className="search__empty">No repositories found for this owner.</div>
  }
  return (
    <>
      <h2>Repositories</h2>
      <ul className="search__list">
        {data.results.map(repo => (
          <li key={`${repo.owner}/${repo.repo}`}>
            <a href={toViewPath({owner: repo.owner, repo: repo.repo})} className="search__row">
              <span className="search__title">{repo.owner}/{repo.repo}</span>
              <span className="search__meta">
                artifacts: <code>{repo.artifact_count}</code>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ArtifactList({data}: {data: ListResponse<ArtifactResult>}) {
  if (data.code === 'not_logged_in') {
    return (
      <div className="search__empty">
        Not signed in. <a href="/login" className="search__link">Sign in</a> to list artifacts.
      </div>
    )
  }
  if (data.code === 'no_access') {
    return <div className="search__empty">The GitHub App can&apos;t confirm access for this repository.</div>
  }
  if (data.results.length === 0) {
    return <div className="search__empty">No artifacts match these filters.</div>
  }
  return (
    <>
      <h2>Artifacts</h2>
      <ul className="search__list">
        {data.results.map(artifact => (
          <li key={artifact.artifactId} className="search__artifact">
            <div className="search__artifact-head">
              {artifact.label && <span className="search__label">{artifact.label}</span>}
              <span className="search__title">{artifact.name}</span>
              <span className="search__meta">{new Date(artifact.createdAt).toLocaleString()}</span>
            </div>
            <div className="search__aliases">
              {artifact.pathParams.map(p => (
                <a
                  key={`${p.aliasType}/${p.identifier}`}
                  href={toAppArtifactPath(p)}
                  className="search__alias"
                  title={`${p.aliasType}: ${p.identifier}`}
                >
                  <span className="search__alias-type">{p.aliasType}</span>
                  <span className="search__alias-value">{p.identifier}</span>
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
