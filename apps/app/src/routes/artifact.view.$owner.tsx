// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {toBreadcrumbs} from '@artifact/domain/artifact/path-params'
import {searchRepos} from '../artifacts/search'
import {Crumbs} from '../ui/crumbs'
import {RepoList} from '../ui/search-lists'

export const Route = createFileRoute('/artifact/view/$owner')({
  loader: async ({params}) => searchRepos({data: {owner: params.owner}}),
  component: OwnerRepos,
})

function OwnerRepos() {
  const params = Route.useParams()
  const data = Route.useLoaderData()
  return (
    <section className="page">
      <Crumbs trail={toBreadcrumbs({owner: params.owner})} />
      <h1>{params.owner}</h1>
      <RepoList data={data} />
    </section>
  )
}
