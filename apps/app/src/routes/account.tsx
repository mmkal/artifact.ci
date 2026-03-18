// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {requireCurrentSession} from '../auth/session'

export const Route = createFileRoute('/account')({
  beforeLoad: async ({location}) => requireCurrentSession({data: {redirectTo: location.href}}),
  component: AccountPage,
})

function AccountPage() {
  const {user} = Route.useRouteContext().session

  return (
    <section className="page">
      <div className="eyebrow">Account</div>
      <h1>Account settings shell.</h1>
      <p>Profile, linked identities, support context, and audit-friendly account controls belong here.</p>
      <div className="meta">
        <div>
          <strong>github</strong>: <code>{user.githubLogin || 'not set yet'}</code>
        </div>
        <div>
          <strong>email</strong>: <code>{user.email || 'unknown'}</code>
        </div>
      </div>
    </section>
  )
}
