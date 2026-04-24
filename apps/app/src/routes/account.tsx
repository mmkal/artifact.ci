// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {requireCurrentSession} from '../auth/session'
import {searchRepos} from '../artifacts/search'
import {LogoutButton} from '../ui/logout-button'
import {RepoList} from '../ui/search-lists'

export const Route = createFileRoute('/account')({
  beforeLoad: async ({location}) => requireCurrentSession({data: {redirectTo: location.href}}),
  loader: async () => searchRepos({data: {}}),
  component: AccountPage,
})

function AccountPage() {
  const {user} = Route.useRouteContext().session
  const repos = Route.useLoaderData()

  return (
    <section className="page">
      <h1>Account</h1>
      <dl className="meta">
        <div>
          <dt>GitHub</dt>
          <dd>
            <code>{user.githubLogin || '—'}</code>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            <code>{user.email || '—'}</code>
          </dd>
        </div>
      </dl>
      <p>
        <a href="https://github.com/settings/installations" rel="noreferrer noopener" target="_blank">
          Manage GitHub App installations →
        </a>
      </p>
      <h2>Your repositories</h2>
      <p>Repos the GitHub App can see for you. Open one to browse its artifacts.</p>
      <RepoList data={repos} />
      <LogoutButton />
    </section>
  )
}
