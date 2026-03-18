// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/billing')({
  component: BillingPage,
})

function BillingPage() {
  return (
    <section className="page">
      <div className="eyebrow">Billing</div>
      <h1>Billing provider swap stays easy.</h1>
      <p>
        Polar or Stripe can slot in here later without affecting docs or the edge artifact-serving Worker.
      </p>
    </section>
  )
}
