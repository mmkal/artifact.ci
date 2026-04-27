// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {toBreadcrumbs} from '@artifact/domain/artifact/path-params'
import {searchArtifacts} from '../artifacts/search'
import {Crumbs} from '../ui/crumbs'
import {ArtifactList} from '../ui/search-lists'

export const Route = createFileRoute('/artifact/view_/$owner_/$repo_/$aliasType_/$identifier')({
  loader: async ({params}) =>
    searchArtifacts({
      data: {
        owner: params.owner,
        repo: params.repo,
        aliasType: params.aliasType,
        identifier: params.identifier,
      },
    }),
  component: IdentifierArtifacts,
})

function IdentifierArtifacts() {
  const params = Route.useParams()
  const data = Route.useLoaderData()
  return (
    <section className="page">
      <Crumbs trail={toBreadcrumbs(params)} />
      <h1>
        {params.owner}/{params.repo}
      </h1>
      <p className="eyebrow">
        {params.aliasType}: <code>{params.identifier}</code>
      </p>
      <ArtifactList data={data} />
    </section>
  )
}
