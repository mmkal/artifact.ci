// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {LoginCard} from '../ui/login-card'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch() as {callbackUrl?: string}

  return (
    <section className="page">
      <div className="eyebrow">Authentication</div>
      <h1>Better Auth lands here next.</h1>
      <p>
        This route is reserved for the first-party sign-in flow. The frontdoor redirects unauthenticated artifact
        requests here with a callback URL.
      </p>
      <LoginCard callbackUrl={search.callbackUrl} />
    </section>
  )
}
