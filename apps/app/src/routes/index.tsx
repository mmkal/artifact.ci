// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {useState} from 'react'

export const Route = createFileRoute('/')({
  component: AppHomePage,
})

function AppHomePage() {
  const {session} = Route.useRouteContext()

  return (
    <section className="page">
      <h1>artifact.ci</h1>
      <p>
        Open an artifact from a GitHub Actions run. Paste the repo + run id + artifact name below, or follow the
        check-run link that appears on each successful workflow run once the GitHub App is installed.
      </p>
      <ArtifactLookup />
      {session.user ? (
        <p>
          Signed in as <code>{session.user.githubLogin || session.user.email || session.user.id}</code>. <a href="/account">Account</a>.
        </p>
      ) : (
        <p>
          <a href="/login">Sign in</a> to view private artifacts. Public artifacts render without an account.
        </p>
      )}
      <p>
        <a href="https://github.com/apps/artifact-ci" rel="noreferrer noopener" target="_blank">
          Install the GitHub App
        </a>{' '}
        on a repo to start getting status-check links on every workflow run.
      </p>
    </section>
  )
}

function ArtifactLookup() {
  const [owner, setOwner] = useState('mmkal')
  const [repo, setRepo] = useState('artifact.ci')
  const [aliasType, setAliasType] = useState<'branch' | 'sha' | 'run'>('branch')
  const [identifier, setIdentifier] = useState('main')
  const [artifactName, setArtifactName] = useState('')

  const target = artifactName
    ? `/app/artifacts/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${aliasType}/${encodeURIComponent(identifier)}/${encodeURIComponent(artifactName)}`
    : ''

  return (
    <form
      className="lookup"
      onSubmit={event => {
        event.preventDefault()
        if (target) window.location.href = target
      }}
    >
      <div className="lookup__row">
        <label>
          <span>owner</span>
          <input value={owner} onChange={e => setOwner(e.target.value)} />
        </label>
        <label>
          <span>repo</span>
          <input value={repo} onChange={e => setRepo(e.target.value)} />
        </label>
      </div>
      <div className="lookup__row">
        <label>
          <span>by</span>
          <select value={aliasType} onChange={e => setAliasType(e.target.value as typeof aliasType)}>
            <option value="branch">branch</option>
            <option value="sha">sha</option>
            <option value="run">run</option>
          </select>
        </label>
        <label>
          <span>identifier</span>
          <input value={identifier} onChange={e => setIdentifier(e.target.value)} />
        </label>
        <label>
          <span>artifact</span>
          <input value={artifactName} onChange={e => setArtifactName(e.target.value)} placeholder="report-name" />
        </label>
      </div>
      <button type="submit" disabled={!artifactName} className="shell__link shell__link--active">
        Open artifact
      </button>
    </form>
  )
}
