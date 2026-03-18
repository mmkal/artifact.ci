// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <section className="page">
      <div className="eyebrow">Settings</div>
      <h1>Product configuration shell.</h1>
      <p>Notifications, defaults, project-level toggles, and future upload behavior controls live here.</p>
    </section>
  )
}
