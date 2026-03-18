// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {requireCurrentSession} from '../auth/session'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({location}) => requireCurrentSession({data: {redirectTo: location.href}}),
  component: DashboardPage,
})

function DashboardPage() {
  const {user} = Route.useRouteContext().session

  return (
    <section className="page">
      <div className="eyebrow">Dashboard</div>
      <h1>Operational overview shell.</h1>
      <p>Usage summaries, recent uploads, access events, and billing state can converge here.</p>
      <div className="badge">Signed in as {user.githubLogin || user.email || user.id}</div>
    </section>
  )
}
