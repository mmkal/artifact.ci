// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: AppHomePage,
})

function AppHomePage() {
  return (
    <section className="hero">
      <div className="eyebrow">App Shell</div>
      <h1>Signed-in product routes live here.</h1>
      <p>
        This TanStack Start app becomes the home for Better Auth, account management, billing, dashboard views,
        and the artifact browser chrome. The actual asset bytes still belong at the edge frontdoor.
      </p>
      <div className="cards">
        <article className="card">
          <h2>Routing contract</h2>
          <p>
            Reserved here: <code>/app/*</code>, <code>/api/*</code>, <code>/login</code>, <code>/account</code>,{' '}
            <code>/billing</code>, <code>/settings</code>, and <code>/dashboard</code>.
          </p>
        </article>
        <article className="card">
          <h2>Auth direction</h2>
          <p>
            Better Auth replaces NextAuth here. The frontdoor only needs enough shared session logic to gate artifact
            delivery.
          </p>
        </article>
        <article className="card">
          <h2>Artifact browser</h2>
          <p>
            Metadata, listing, and signed-in UI stay here; binary delivery and headers stay in the Cloudflare
            frontdoor Worker.
          </p>
        </article>
      </div>
    </section>
  )
}
