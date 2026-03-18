// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/app/artifacts/$owner/$repo/$aliasType/$identifier/$artifactName')({
  component: ArtifactBrowserPage,
})

function ArtifactBrowserPage() {
  const params = Route.useParams()

  return (
    <section className="page">
      <div className="eyebrow">Artifact Browser</div>
      <h1>{params.artifactName}</h1>
      <p>
        This page becomes the signed-in browser shell for artifact metadata, entrypoints, navigation, and action
        controls. Actual file bytes remain on <code>/artifact/blob/*</code> through the frontdoor Worker.
      </p>
      <div className="meta">
        <div>
          <strong>repo</strong>: <code>{params.owner}/{params.repo}</code>
        </div>
        <div>
          <strong>selector</strong>: <code>{params.aliasType}/{params.identifier}</code>
        </div>
        <div>
          <strong>app path</strong>: <code>{Route.fullPath}</code>
        </div>
      </div>
    </section>
  )
}
