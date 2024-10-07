import {redirect} from 'next/navigation'
import {ClientLayout} from './layout.client'
import {loadArtifact, PathParams} from './load-artifact.server'
import {ArtifactLoader} from './loader'
import {auth} from '~/auth'
import {logger} from '~/tag-logger'

export default async function ArtifactPage({params}: {params: PathParams}) {
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
  if (artifact.outcome === 'not_uploaded_yet') {
    return (
      <ClientLayout>
        <ArtifactLoader />
      </ClientLayout>
    )
  }

  return (
    <div>
      <h1>{params.artifactName}</h1>
      <div>
        {artifact.artifactInfo.entries?.map(e => (
          <div key={e}>
            <a
              href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${e}`}
            >
              {e}
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
