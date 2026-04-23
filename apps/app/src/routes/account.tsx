// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {requireCurrentSession} from '../auth/session'
import {LogoutButton} from '../ui/logout-button'

export const Route = createFileRoute('/account')({
  beforeLoad: async ({location}) => requireCurrentSession({data: {redirectTo: location.href}}),
  component: AccountPage,
})

function AccountPage() {
  const {user} = Route.useRouteContext().session

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
      <LogoutButton />
    </section>
  )
}
