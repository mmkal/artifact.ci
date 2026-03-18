// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <section className="page">
      <div className="eyebrow">Authentication</div>
      <h1>Better Auth lands here next.</h1>
      <p>
        This route is reserved for the first-party sign-in flow. The frontdoor redirects unauthenticated artifact
        requests here with a callback URL.
      </p>
      <div className="badge">Planned: Better Auth + GitHub + first-party cookies</div>
    </section>
  )
}
