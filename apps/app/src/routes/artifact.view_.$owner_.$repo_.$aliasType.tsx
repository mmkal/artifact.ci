// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {toBreadcrumbs} from '@artifact/domain/artifact/path-params'
import {searchArtifacts} from '../artifacts/search'
import {Crumbs} from '../ui/crumbs'
import {ArtifactList} from '../ui/search-lists'

export const Route = createFileRoute('/artifact/view_/$owner_/$repo_/$aliasType')({
  loader: async ({params}) =>
    searchArtifacts({
      data: {owner: params.owner, repo: params.repo, aliasType: params.aliasType},
    }),
  component: AliasTypeArtifacts,
})

function AliasTypeArtifacts() {
  const params = Route.useParams()
  const data = Route.useLoaderData()
  return (
    <section className="page">
      <Crumbs trail={toBreadcrumbs(params)} />
      <h1>{params.owner}/{params.repo}</h1>
      <p className="eyebrow">aliasType: {params.aliasType}</p>
      <ArtifactList data={data} />
    </section>
  )
}
