import React from 'react'
import {DeleteButton} from './DeleteButton'
import {getEntrypoints} from './entrypoints'
import {type PathParams} from '~/app/artifact/view/params'

interface FileListProps {
  names: string[]
  params: PathParams
  artifactId: string
}

export function FileList({names, params, artifactId}: FileListProps) {
  const {entrypoints} = getEntrypoints(names)

  return (
    <>
      <div className="mb-8">
        {entrypoints.length < names.length && (
          <h2 className="text-2xl font-semibold mb-4 border-b border-amber-300/50 pb-2">Detected Entrypoints</h2>
        )}
        <div className="space-y-2">
          {entrypoints.map(({path: entry}) => (
            <div key={entry} className="border border-amber-400/30 p-3 rounded-md hover:bg-gray-900 transition-colors">
              <a
                href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${entry}`}
                className="block text-amber-200/80 hover:text-amber-100 truncate"
                title={entry}
              >
                {'>'} {entry}
              </a>
            </div>
          ))}
        </div>
      </div>

      {entrypoints.length < names.length && (
        <>
          <h2 className="text-2xl font-semibold mb-4 border-b border-amber-300/50 pb-2">All Files</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {names.map(entry => (
              <div
                key={entry}
                className="border border-amber-400/30 p-3 rounded-md hover:bg-gray-900 transition-colors"
              >
                <a
                  href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${entry}`}
                  className="block text-amber-200/80 hover:text-amber-100 truncate"
                  title={entry}
                >
                  {'>'} {entry}
                </a>
              </div>
            ))}
          </div>
        </>
      )}

      {params.owner === 'mmkal' && (
        <div className="mt-8">
          <DeleteButton
            artifactId={artifactId}
            className="w-full border border-red-400/30 p-3 rounded-md hover:bg-red-900/15 transition-colors text-red-200/80 hover:text-red-100 font-bold text-left"
          >
            {'>'} Delete Entries
          </DeleteButton>
        </div>
      )}
    </>
  )
}
