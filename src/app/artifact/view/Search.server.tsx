import Link from 'next/link'
import React from 'react'
import {toPath} from './params'
import {searchArtifacts} from './search'

export declare namespace SearchUI {
  type Props = {results: Awaited<ReturnType<typeof searchArtifacts>>}
}
export function SearchUI({results}: SearchUI.Props) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold mb-4">Artifacts</h2>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto scroll-smooth snap-y snap-mandatory pr-5">
        {results.length === 0 ? (
          <div className="p-3 rounded-md hover:bg-gray-900">No artifacts found</div>
        ) : (
          results.map(({pathParams, label, name}, index) => (
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
          ))
        )}
      </div>
    </div>
  )
}
