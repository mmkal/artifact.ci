// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <section className="page">
      <div className="eyebrow">Dashboard</div>
      <h1>Operational overview shell.</h1>
      <p>Usage summaries, recent uploads, access events, and billing state can converge here.</p>
    </section>
  )
}
