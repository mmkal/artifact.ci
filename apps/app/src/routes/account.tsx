// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/account')({
  component: AccountPage,
})

function AccountPage() {
  return (
    <section className="page">
      <div className="eyebrow">Account</div>
      <h1>Account settings shell.</h1>
      <p>Profile, linked identities, support context, and audit-friendly account controls belong here.</p>
    </section>
  )
}
