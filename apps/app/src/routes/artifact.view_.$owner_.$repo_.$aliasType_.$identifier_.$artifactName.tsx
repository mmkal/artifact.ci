// @ts-nocheck
import {toBreadcrumbs} from '@artifact/domain/artifact/path-params'
import {createFileRoute, redirect} from '@tanstack/react-router'
import {loadArtifactForBrowser, type LoadArtifactResult} from '../artifacts/load'
import {ArtifactLoader} from '../ui/artifact-loader'
import {Crumbs} from '../ui/crumbs'
import {FileList} from '../ui/file-list'
import {TrpcProvider} from '../ui/trpc-provider'

type Search = {reload?: 'true'; delete?: 'true'}

export const Route = createFileRoute('/artifact/view_/$owner_/$repo_/$aliasType_/$identifier_/$artifactName')({
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
  const data = Route.useLoaderData()

  const reload = search.reload === 'true'
  const allowDelete = search.delete === 'true'

  if (data.resolved.code === 'artifact_not_found') {
    const missing = data.resolved.missing
    return (
      <section className="page browser">
        <div className="eyebrow">Artifact Browser</div>
        <h1>{params.artifactName}</h1>
        {missing.kind === 'repo_not_registered' ? (
          <p>
            The artifact-ci GitHub App isn&apos;t installed on a repo at this URL.{' '}
            <a href="https://github.com/apps/artifact-ci" rel="noreferrer noopener" target="_blank">
              Install it
            </a>{' '}
            to start collecting artifacts. (If you&apos;re sure it should already be installed, double-check the
            owner and repo in the URL.)
          </p>
        ) : missing.kind === 'no_artifact_in_repo' ? (
          <p>
            No artifact named <code>{missing.artifactName}</code> has been recorded for{' '}
            <code>
              {missing.owner}/{missing.repo}
            </code>
            . If GitHub Actions just produced it, our webhook may not have fired — open an issue and we&apos;ll
            help backfill it.
          </p>
        ) : missing.kind === 'no_identifier_for_artifact' ? (
          <p>
            We have an artifact named <code>{missing.artifactName}</code> in{' '}
            <code>
              {missing.owner}/{missing.repo}
            </code>
            , but no <code>{missing.aliasType}</code> alias for{' '}
            <code>{missing.identifier}</code>. Double-check the identifier in the URL.
          </p>
        ) : (
          <p>Not found. Double-check the owner, repo, alias, identifier, and artifact name.</p>
        )}
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
      <Crumbs trail={toBreadcrumbs(params)} />
      <h1>{params.artifactName}</h1>
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
          <ArtifactLoader {...loaderProps} />
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
