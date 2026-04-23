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
      <h1>Sign in</h1>
      <p>Sign in with GitHub to view your private artifacts.</p>
      <LoginCard callbackUrl={search.callbackUrl} />
    </section>
  )
}
