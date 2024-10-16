import Link from 'next/link'
import React from 'react'
import {toPath} from './params'
import {searchArtifacts, searchRepos} from './search'

export declare namespace SearchUI {
  type Props = {results: Awaited<ReturnType<typeof searchArtifacts>>}
}

export declare namespace SearchReposUI {
  type Props = {results: Awaited<ReturnType<typeof searchRepos>>}
}

export function SearchReposUI({results}: SearchReposUI.Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        {results.length === 0 && 'code' in results && results.code === 'not_logged_in' ? (
          <div className="p-3 rounded-md hover:bg-gray-900">Not logged in</div>
        ) : results.length === 0 ? (
          <div className="p-3 rounded-md hover:bg-gray-900">No repositories found</div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold mb-4">Repositories</h2>
            {results.map((repo, index) => (
              <div key={index} className="snap-start">
                <div className="p-3 rounded-md transition duration-300 ease-in-out">
                  <span className="text-lg font-semibold text-amber-400">
                    {repo.owner}/{repo.repo}
                  </span>
                  <span className="ml-3 text-sm text-gray-300">Artifacts: {repo.artifact_count}</span>
                  <Link
                    href={toPath({owner: repo.owner, repo: repo.repo})}
                    className="ml-3 border border-amber-400/30 p-2 rounded-md hover:bg-gray-900 transition-colors text-sm"
                  >
                    View Repository
                  </Link>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export function SearchUI({results}: SearchUI.Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        {results.length === 0 && 'code' in results && results.code === 'not_logged_in' ? (
          <div className="p-3 rounded-md hover:bg-gray-900">Not logged in</div>
        ) : results.length === 0 ? (
          <div className="p-3 rounded-md hover:bg-gray-900">No artifacts found</div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold mb-4">Artifacts</h2>
            {results.map(({pathParams, label, name}, index) => (
              <div key={index} className="snap-start">
                <div className="p-3 rounded-md transition duration-300 ease-in-out">
                  <span className="text-sm text-amber-400 mr-3">{label}</span>
                  <span className="text-lg font-semibold text-amber-400">{name}</span>
                  <span className="ml-3 text-sm text-gray-300 gap-2 inline-flex flex-row">
                    {pathParams.map(p => (
                      <Link
                        href={toPath(p)}
                        key={p.aliasType}
                        className="border border-amber-400/30 p-3 rounded-md hover:bg-gray-900 transition-colors"
                      >
                        {p.aliasType}/{p.identifier}
                      </Link>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
