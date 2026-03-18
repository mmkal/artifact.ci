// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {requireCurrentSession} from '../auth/session'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({location}) => requireCurrentSession({data: {redirectTo: location.href}}),
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
