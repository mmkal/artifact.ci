import {redirect} from 'next/navigation'
import {ClientLayout} from './TrpcProvider'
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
        <ArtifactLoader {...artifact.loaderParams} />
      </ClientLayout>
    )
  }
  artifact.outcome satisfies '2xx'

  return (
    <div className="bg-gray-900 text-green-400 p-6 font-mono">
      <h1 className="text-3xl font-bold mb-6 border-b-2 border-green-500 pb-2">{params.artifactName}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {artifact.artifactInfo.entries?.map(e => (
          <div key={e} className="border border-green-600 p-3 rounded-md hover:bg-gray-800 transition-colors">
            <a
              href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${e}`}
              className="block text-green-400 hover:text-green-300"
            >
              {'>'} {e}
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
