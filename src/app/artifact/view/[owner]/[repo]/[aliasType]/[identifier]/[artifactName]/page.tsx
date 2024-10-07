import {redirect} from 'next/navigation'
import {ClientLayout} from './TrpcProvider'
import {loadArtifact, PathParams} from './load-artifact.server'
import {ArtifactLoader} from './loader'
import {getEntrypoints} from '~/app/artifact/upload/signed-url/route'
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

  const {entrypoints} = getEntrypoints(artifact.artifactInfo.entries || [])

  return (
    <div className="bg-gray-900 text-amber-400 p-6 font-mono">
      <h1 className="text-3xl font-bold mb-6 border-b-2 border-amber-500 pb-2">artifact: {params.artifactName}</h1>

      {/* Entrypoints section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 border-b border-amber-500 pb-2">Detected Entrypoints</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entrypoints.map(entry => (
            <div key={entry} className="border border-amber-600 p-3 rounded-md hover:bg-gray-800 transition-colors">
              <a
                href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${entry}`}
                className="block text-amber-400 hover:text-amber-300 truncate"
                title={entry}
              >
                {'>'} {entry}
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* All files section */}
      <h2 className="text-2xl font-semibold mb-4 border-b border-amber-500 pb-2">All Files</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {artifact.artifactInfo.entries?.map(e => (
          <div key={e} className="border border-amber-600 p-3 rounded-md hover:bg-gray-800 transition-colors">
            <a
              href={`/artifact/view/${params.owner}/${params.repo}/${params.aliasType}/${params.identifier}/${params.artifactName}/${e}`}
              className="block text-amber-400 hover:text-amber-300 truncate"
              title={e}
            >
              {'>'} {e}
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
