import Link from 'next/link'
import React from 'react'
import {PathParams, toPath} from './[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/params'
import {searchArtifacts} from './search'

export async function ArtifactViewPage({params}: {params: Partial<PathParams>}) {
  const results = await searchArtifacts(params)

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold mb-4">Search Results</h2>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        {results.length === 0 ? (
          <div className="p-3 rounded-md hover:bg-gray-900">No artifacts found matching the search criteria.</div>
        ) : (
          results.map(({pathParams}, index) => (
            <div key={index} className="snap-start">
              <Link href={toPath(pathParams)}>
                <div className="p-3 rounded-md hover:bg-gray-900 transition duration-300 ease-in-out">
                  <h3 className="text-lg font-semibold text-amber-400">{pathParams.artifactName}</h3>
                  <p className="text-sm text-gray-300">
                    Owner: {pathParams.owner} | Repo: {pathParams.repo} | Type: {pathParams.aliasType}
                  </p>
                  {/* <p className="text-sm text-gray-400 mt-1">{artifact.description || 'No description available'}</p> */}
                </div>
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
