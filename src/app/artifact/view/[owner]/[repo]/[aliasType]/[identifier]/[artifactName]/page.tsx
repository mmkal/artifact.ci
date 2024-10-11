import {redirect} from 'next/navigation'
import {ArtifactLoader} from './ArtifactLoader'
import {FileList} from './FileList'
import {TrpcProvider} from './TrpcProvider'
import {loadArtifact} from './load-artifact.server'
import {PostHogProvider} from '~/analytics/posthog-client'
import {captureServerEvent, checkContext} from '~/analytics/posthog-server'
import {ArtifactViewPageTemplate} from '~/app/artifact/view/nav'
import {toFullUrl, type PathParams} from '~/app/artifact/view/params'
import {auth} from '~/auth'
import {productionUrl} from '~/site-config'
import {logger} from '~/tag-logger'

export declare namespace ArtifactPage {
  export type Params = {params: PathParams; searchParams: {reload?: 'true'}}
}

export default async function ArtifactPage({params, searchParams}: ArtifactPage.Params) {
  return (
    <ArtifactViewPageTemplate params={params}>
      <ArtifactPageInner params={params} searchParams={searchParams} />
    </ArtifactViewPageTemplate>
  )
}

async function ArtifactPageInner({params, searchParams}: ArtifactPage.Params) {
  const session = await auth()
  checkContext('ArtifactPageInner')

  const githubLogin = session?.user?.github_login

  if (!githubLogin) {
    const callbackUrl = `/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}`
    return redirect(`/api/auth/signin?${new URLSearchParams({callbackUrl})}`)
  }

  const artifact = await logger.try('pageLoad', () => loadArtifact(githubLogin, {params}))

  captureServerEvent({
    distinctId: githubLogin,
    event: `artifact_load.${artifact.outcome}`,
    properties: {
      ...artifact,
      $current_url: toFullUrl(params, searchParams),
    },
  })

  if (artifact.outcome === '4xx' && artifact.body.code === 'no_credit') {
    return (
      <>
        <h2>No credit!</h2>
        <p>
          {`Artifacts don't grow on trees. You've run out of free credits. `}
          <a
            href="https://github.com/sponsors/mmkal"
            target="_blank"
            className="inline-block bg-amber-700/30 hover:bg-amber-600/20 text-amber-100 font-bold py-1 px-3 rounded border border-amber-400/50 transition duration-300 ease-in-out"
            rel="noreferrer"
          >
            Sponsor me
          </a>
          {` to keep using ${productionUrl.hostname}. If you're not sure, or you'd like more credits, `}
          <a
            href="https://x.com/mmkalmmkal"
            target="_blank"
            className="inline-block bg-amber-700/30 hover:bg-amber-600/20 text-amber-100 font-bold py-1 px-3 rounded border border-amber-400/50 transition duration-300 ease-in-out"
            rel="noreferrer"
          >
            DM me on Twitter
          </a>
          {'.'}
        </p>
      </>
    )
  }

  if (artifact.outcome === '4xx') {
    return <pre>{JSON.stringify(artifact, null, 2)}</pre>
  }
  if (artifact.outcome === 'not_uploaded_yet' || searchParams.reload === 'true') {
    return (
      <TrpcProvider>
        <PostHogProvider>
          <ArtifactLoader {...artifact.loaderParams} />
        </PostHogProvider>
      </TrpcProvider>
    )
  }
  artifact.outcome satisfies '2xx'

  return (
    <FileList
      names={artifact.artifactInfo.entries || []}
      params={params}
      artifactId={artifact.artifactInfo.artifact_id}
    />
  )
}
