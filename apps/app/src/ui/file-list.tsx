import {getEntrypoints} from '@artifact/domain/artifact/entrypoints'
import {toBlobPath} from '@artifact/domain/artifact/path-params'
import type {PathParams} from '@artifact/domain/artifact/path-params'
import {DeleteButton} from './delete-button'

interface FileListProps {
  names: string[]
  params: PathParams
  artifactId: string
  allowDelete?: boolean
}

export function FileList({names, params, artifactId, allowDelete}: FileListProps) {
  const {entrypoints} = getEntrypoints(names)
  const showAllFiles = entrypoints.length < names.length

  return (
    <>
      {showAllFiles && <h2 className="browser__heading">Detected Entrypoints</h2>}
      <div className="browser__list">
        {entrypoints.map(({path: entry}) => (
          <FileRow key={entry} entry={entry} params={params} />
        ))}
      </div>

      {showAllFiles && (
        <>
          <h2 className="browser__heading">All Files</h2>
          <div className="browser__grid">
            {names.map(entry => (
              <FileRow key={entry} entry={entry} params={params} />
            ))}
          </div>
        </>
      )}

      {allowDelete && (
        <div className="browser__danger">
          <DeleteButton artifactId={artifactId} />
        </div>
      )}
    </>
  )
}

function FileRow({entry, params}: {entry: string; params: PathParams}) {
  const href = toBlobPath({...params, filepath: entry.split('/')})
  return (
    <a href={href} className="browser__row" title={entry}>
      <span className="browser__arrow">&gt;</span> {entry}
    </a>
  )
}
