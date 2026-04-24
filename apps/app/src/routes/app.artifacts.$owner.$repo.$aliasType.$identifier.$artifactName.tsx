// @ts-nocheck
import {createFileRoute, redirect} from '@tanstack/react-router'
import {loadArtifactForBrowser, type LoadArtifactResult} from '../artifacts/load'
import {ArtifactLoader} from '../ui/artifact-loader'
import {FileList} from '../ui/file-list'
import {TrpcProvider} from '../ui/trpc-provider'

type Search = {reload?: 'true'; delete?: 'true'}

export const Route = createFileRoute('/app/artifacts/$owner/$repo/$aliasType/$identifier/$artifactName')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    reload: search.reload === 'true' ? 'true' : undefined,
    delete: search.delete === 'true' ? 'true' : undefined,
  }),
  // No beforeLoad session gate: public artifacts are viewable without login.
  // The loader redirects to /login only when access is denied because of a
  // missing session.
  loader: async ({params, location}) => {
    const data: LoadArtifactResult = await loadArtifactForBrowser({data: params})
    if (data.resolved.code === 'not_authorized' && !data.githubLogin) {
      throw redirect({
        to: '/login',
        search: {callbackUrl: location.href},
      })
    }
    return data
  },
  component: ArtifactBrowserPage,
})

function ArtifactBrowserPage() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const data = Route.useLoaderData() as LoadArtifactResult

  const reload = search.reload === 'true'
  const allowDelete = search.delete === 'true'

  if (data.resolved.code === 'artifact_not_found') {
    return (
      <section className="page browser">
        <div className="eyebrow">Artifact Browser</div>
        <h1>{params.artifactName}</h1>
        <p>Not found. Double-check the owner, repo, alias, identifier, and artifact name.</p>
        <pre className="browser__debug">{JSON.stringify(data.resolved, null, 2)}</pre>
      </section>
    )
  }

  if (data.resolved.code === 'not_authorized') {
    const reason = data.resolved.access.code
    if (reason === 'no_credit') {
      return (
        <section className="page browser">
          <div className="eyebrow">Out of credits</div>
          <h1>No credit.</h1>
          <p>
            Artifacts don&apos;t grow on trees. Sponsor{' '}
            <a href="https://github.com/sponsors/mmkal" rel="noreferrer noopener" target="_blank">
              @mmkal
            </a>{' '}
            to keep using artifact.ci, or DM me on Twitter if you&apos;d like more credits.
          </p>
        </section>
      )
    }

    return (
      <section className="page browser">
        <div className="eyebrow">Not authorized</div>
        <h1>{params.artifactName}</h1>
        <p>You don&apos;t have access to this artifact.</p>
        <pre className="browser__debug">{JSON.stringify(data.resolved, null, 2)}</pre>
      </section>
    )
  }

  if (data.resolved.code === 'upload_not_found') {
    return (
      <section className="page browser">
        <div className="eyebrow">Upload missing</div>
        <h1>{params.artifactName}</h1>
        <pre className="browser__debug">{JSON.stringify(data.resolved, null, 2)}</pre>
      </section>
    )
  }

  const header = (
    <>
      <div className="eyebrow">Artifact Browser</div>
      <h1>{params.artifactName}</h1>
      <div className="browser__breadcrumbs">
        <code>
          {params.owner}/{params.repo} · {params.aliasType}/{params.identifier}
        </code>
      </div>
    </>
  )

  if (data.resolved.code === 'not_uploaded_yet' || reload) {
    const loaderProps =
      data.resolved.code === 'not_uploaded_yet'
        ? data.resolved.loaderParams
        : {
            ...params,
            githubLogin: data.githubLogin ?? undefined,
            artifactId: data.resolved.artifactInfo.artifactId,
            entry: null,
          }
    return (
      <TrpcProvider>
        <section className="page browser">
          {header}
          <ArtifactLoader {...loaderProps} reload={reload} />
        </section>
      </TrpcProvider>
    )
  }

  data.resolved.code satisfies '2xx'
  return (
    <TrpcProvider>
      <section className="page browser">
        {header}
        <FileList
          names={data.resolved.artifactInfo.entries || []}
          params={params}
          artifactId={data.resolved.artifactInfo.artifactId}
          allowDelete={allowDelete}
        />
      </section>
    </TrpcProvider>
  )
}
