import {createTRPCClient, httpLink} from '@trpc/client'
import pMap from 'p-suite/p-map'
import {unzip} from 'unzipit'

type UploadClient = {
  getDownloadUrl: {query(input: {artifactId: string}): Promise<{url: string; githubId: number}>}
  createUploadTokens: {
    mutate(input: {artifactId: string; entries: string[]}): Promise<{
      tokens: Array<{entry: string; artifactFullPath: string; uploadUrl: string; contentType: string}>
    }>
  }
  storeUploadRecords: {
    mutate(input: {
      artifactId: string
      uploads: Array<{entry: string; artifactFullPath: string; uploadUrl: string; contentType: string}>
    }): Promise<{
      records: Array<{entry_name: string; aliases: string[]; storage_pathname: string}>
      entrypoints: {entrypoints: Array<{path: string; shortened: string}>; flatAliases: string[]}
    }>
  }
}

export declare namespace clientUpload {
  export type Params = {
    artifactId: string
    onProgress?: (stage: string, message: string) => void
    trpcClient?: UploadClient
    trpcUrl?: string
    uploadToken?: string
  }
}

function createUploadClient({trpcUrl, uploadToken}: {trpcUrl: string; uploadToken: string}) {
  return createTRPCClient<any>({
    links: [
      httpLink({
        url: trpcUrl,
        headers: {'artifactci-upload-token': uploadToken},
      }),
    ],
  }) as unknown as UploadClient
}

export async function clientUpload({
  artifactId,
  onProgress = () => {},
  trpcClient,
  trpcUrl,
  uploadToken,
}: clientUpload.Params) {
  const client = trpcClient || createUploadClient({trpcUrl: trpcUrl!, uploadToken: uploadToken!})

  onProgress('start', 'Getting artifact information')
  const download = await client.getDownloadUrl.query({artifactId})
  onProgress('downloading', 'Downloading archive ' + download.githubId)

  const response = await fetch(download.url)

  onProgress('extracting', 'Extracting archive')
  const {entries} = await unzip(await response.arrayBuffer())

  onProgress('preparing', 'Getting upload tokens')
  // Keep token signing payloads bounded for artifacts with very large file
  // counts; R2 signing is local crypto, but the tRPC body can still get large.
  const allEntries = Object.keys(entries)
  const SIGNING_CHUNK = 200
  const uploads: Array<Awaited<ReturnType<typeof client.createUploadTokens.mutate>>['tokens'][number]> = []
  for (let i = 0; i < allEntries.length; i += SIGNING_CHUNK) {
    const chunk = allEntries.slice(i, i + SIGNING_CHUNK)
    const result = await client.createUploadTokens.mutate({artifactId, entries: chunk})
    uploads.push(...result.tokens)
    onProgress('preparing', `Getting upload tokens (${Math.min(i + SIGNING_CHUNK, allEntries.length)}/${allEntries.length})`)
  }

  onProgress('uploading', 'Uploading files')
  onProgress('uploaded_file', `Uploaded 0 of ${uploads.length} files`)
  let uploaded = 0
  await pMap(
    uploads,
    async item => {
      const message = () => `Uploaded ${++uploaded} of ${uploads.length} files: ${item.entry.split('/').pop()}`
      const response = await fetch(item.uploadUrl, {
        method: 'PUT',
        headers: {'content-type': item.contentType},
        body: await entries[item.entry].blob(),
      })
      if (!response.ok) {
        throw new Error(`failed to upload ${item.entry}: ${response.status} ${await response.text()}`)
      }
      onProgress('uploaded_file', message())
    },
    {concurrency: 10},
  )
  onProgress('uploaded_file', `Uploaded ${uploads.length} of ${uploads.length} files`)

  onProgress('saving', 'Saving upload records')
  const records = await client.storeUploadRecords.mutate({artifactId, uploads})

  onProgress('success', 'Done')

  return records
}
