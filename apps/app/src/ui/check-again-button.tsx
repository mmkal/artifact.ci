import type {ArtifactDiagnosticResult} from '../artifacts/github-diagnostics'
import {trpc} from '../trpc/client'

export function CheckAgainButton(props: {owner: string; repo: string; aliasType: string; identifier: string}) {
  const mutation = trpc.diagnoseArtifactRequest.useMutation()
  const isBusy = mutation.status === 'pending'
  return (
    <div className="diagnostic">
      <button type="button" className="browser__action" disabled={isBusy} onClick={() => mutation.mutate(props)}>
        {isBusy ? 'Checking GitHub...' : 'Check again'}
      </button>
      {mutation.error && <div className="diagnostic__error">{mutation.error.message}</div>}
      {mutation.data && <DiagnosticResult data={mutation.data} />}
    </div>
  )
}

function DiagnosticResult({data}: {data: ArtifactDiagnosticResult}) {
  const recordedCount = data.runs.flatMap(run => run.artifacts).filter(artifact => artifact.recorded).length
  const reloadPath = typeof window === 'undefined' ? '' : window.location.pathname
  return (
    <div className="diagnostic__result">
      <div className="diagnostic__summary">
        Checked GitHub at <code>{new Date(data.checkedAt).toLocaleString()}</code>. Found{' '}
        <code>{data.runs.length}</code> workflow run{data.runs.length === 1 ? '' : 's'} and recorded{' '}
        <code>{recordedCount}</code> artifact
        {recordedCount === 1 ? '' : 's'}.
      </div>
      {recordedCount > 0 && (
        <a href={reloadPath} className="diagnostic__reload">
          Reload artifact list
        </a>
      )}
      {data.notes.length > 0 && (
        <ul className="diagnostic__notes">
          {data.notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="diagnostic__runs">
        {data.runs.map(run => (
          <div key={run.id} className="diagnostic__run">
            <div className="diagnostic__run-head">
              <a href={run.htmlUrl} rel="noreferrer noopener" target="_blank">
                {run.name}
              </a>
              <span>
                run <code>{run.id}</code>
              </span>
              <span>
                {run.status}
                {run.conclusion ? ` / ${run.conclusion}` : ''}
              </span>
              <span>
                sha <code>{run.headSha.slice(0, 7)}</code>
              </span>
            </div>
            <ArtifactDiagnostics run={run} />
            <JobDiagnostics run={run} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ArtifactDiagnostics({run}: {run: ArtifactDiagnosticResult['runs'][number]}) {
  if (run.artifacts.length === 0) {
    return <div className="diagnostic__empty">GitHub currently reports no artifacts for this run.</div>
  }
  return (
    <ul className="diagnostic__list">
      {run.artifacts.map(artifact => (
        <li key={artifact.id}>
          <span>{artifact.name}</span>{' '}
          {artifact.expired ? (
            <span>expired{artifact.expiresAt ? ` ${new Date(artifact.expiresAt).toLocaleString()}` : ''}</span>
          ) : artifact.recorded ? (
            <span>recorded</span>
          ) : artifact.recordError ? (
            <span>not recorded: {artifact.recordError}</span>
          ) : (
            <span>available</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function JobDiagnostics({run}: {run: ArtifactDiagnosticResult['runs'][number]}) {
  const jobsWithUploadArtifact = run.jobs.filter(
    job =>
      job.uploadArtifact?.hasUploadArtifactStep || job.uploadArtifact?.hasEmptyUpload || job.logStatus !== 'checked',
  )
  if (jobsWithUploadArtifact.length === 0) return null
  return (
    <div className="diagnostic__jobs">
      {jobsWithUploadArtifact.map(job => (
        <div key={job.id} className="diagnostic__job">
          <div>
            <a href={job.htmlUrl} rel="noreferrer noopener" target="_blank">
              {job.name}
            </a>{' '}
            <span>
              {job.status}
              {job.conclusion ? ` / ${job.conclusion}` : ''}
            </span>
          </div>
          {job.logStatus !== 'checked' && <div>{job.logMessage || job.logStatus}</div>}
          {job.uploadArtifact?.hasEmptyUpload && <div>upload-artifact ran but did not find files to upload.</div>}
          {job.uploadArtifact?.messages.length ? (
            <ul className="diagnostic__log-lines">
              {job.uploadArtifact.messages.map(message => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  )
}
