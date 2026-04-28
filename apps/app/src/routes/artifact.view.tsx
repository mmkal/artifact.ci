// @ts-nocheck
import {createFileRoute} from '@tanstack/react-router'
import {searchRepos} from '../artifacts/search'
import {Crumbs} from '../ui/crumbs'
import {RepoList} from '../ui/search-lists'

export const Route = createFileRoute('/artifact/view')({
  loader: async () => searchRepos({data: {}}),
  component: ArtifactViewIndex,
})

function ArtifactViewIndex() {
  const data = Route.useLoaderData()
  return (
    <section className="page">
      <Crumbs trail={[{label: 'Artifacts', path: '/artifact/view'}]} />
      <h1>Artifacts</h1>
      <p>Browse repositories the GitHub App can access.</p>
      <RepoList data={data} />
    </section>
  )
}
