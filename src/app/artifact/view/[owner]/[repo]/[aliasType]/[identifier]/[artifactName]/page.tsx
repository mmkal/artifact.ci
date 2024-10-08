import {redirect} from 'next/navigation'
import {FileList} from './FileList'
import {TrpcProvider} from './TrpcProvider'
import {loadArtifact} from './load-artifact.server'
import {ArtifactLoader} from './loader'
import {ArtifactViewPageTemplate} from '~/app/artifact/view/nav'
import {type PathParams} from '~/app/artifact/view/params'
import {auth} from '~/auth'
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

  const githubLogin = session?.user?.github_login
  if (!githubLogin) {
    const callbackUrl = `/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}`
    return redirect(`/api/auth/signin?${new URLSearchParams({callbackUrl})}`)
  }

  const artifact = await logger.try('pageLoad', () => loadArtifact(githubLogin, {params}))
  if (artifact.outcome === '4xx') {
    return <pre>{JSON.stringify(artifact, null, 2)}</pre>
  }
  if (artifact.outcome === 'not_uploaded_yet' || searchParams.reload === 'true') {
    return (
      <TrpcProvider>
        <ArtifactLoader {...artifact.loaderParams} />
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
