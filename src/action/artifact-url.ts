const artifactViewPrefix = '/artifact/view/'
const artifactBlobPrefix = '/artifact/blob/'

export function toArtifactFileUrl(artifactViewUrl: string, entryPath: string) {
  const url = new URL(artifactViewUrl)
  if (!url.pathname.startsWith(artifactViewPrefix)) {
    throw new Error(`artifact URL must start with ${artifactViewPrefix}: ${artifactViewUrl}`)
  }

  url.pathname = url.pathname.replace(artifactViewPrefix, artifactBlobPrefix)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${entryPath.replace(/^\/+/, '')}`
  return url.toString()
}
