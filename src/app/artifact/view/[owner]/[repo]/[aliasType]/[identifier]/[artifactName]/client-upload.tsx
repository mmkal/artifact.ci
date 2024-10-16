import pMap from 'p-suite/p-map'
import {unzip} from 'unzipit'
import {trpcClient as defaultTrpcClient} from '~/client/trpc'
import {createProxyClient} from '~/openapi/client'
import {paths} from '~/openapi/generated/supabase-storage'

export declare namespace clientUpload {
  export type Params = {
    artifactId: string
    onProgress?: (stage: string, message: string) => void
    trpcClient?: typeof defaultTrpcClient
  }
}

/** Pulls an artifact and uploads to a storage bucket. The server is used for auth, but the hard work (/most bandwidth usage 😈) is done by the client. */
export async function clientUpload({
  artifactId,
  onProgress = () => {},
  trpcClient = defaultTrpcClient,
}: clientUpload.Params) {
  onProgress('start', 'Getting artifact information')
  const download = await trpcClient.getDownloadUrl.query({artifactId})
  onProgress('downloading', 'Downloading archive ' + download.githubId)

  const response = await fetch(download.url)

  onProgress('extracting', 'Extracting archive')
  const {entries} = await unzip(await response.arrayBuffer())

  onProgress('preparing', 'Getting upload tokens')
  const {tokens: uploads, supabaseUrl} = await trpcClient.createUploadTokens.mutate({
    artifactId,
    entries: Object.keys(entries),
  })

  onProgress('uploading', 'Uploading files')
  const storage = createProxyClient<paths>().configure({baseUrl: supabaseUrl}) // note: no auth here, we rely on signed urls

  onProgress('uploaded_file', `Uploaded 0 of ${uploads.length} files`)
  let uploaded = 0
  await pMap(
    uploads,
    async item => {
      const message = () => `Uploaded ${++uploaded} of ${uploads.length} files: ${item.entry.split('/').pop()}`
      if (!item.token) {
        onProgress('uploaded_file', message() + ' (already uploaded)')
        return
      }
      await storage.object.upload.sign
        .bucketName('artifact_files')
        .wildcard(item.artifactFullPath)
        .put({
          query: {token: item.token},
          content: {[item.contentType]: await entries[item.entry].blob()},
        })
      onProgress('uploaded_file', message())
    },
    {concurrency: 10},
  )
  onProgress('uploaded_file', `Uploaded ${uploads.length} of ${uploads.length} files`)

  onProgress('saving', 'Saving upload records')
  const records = await trpcClient.storeUploadRecords.mutate({artifactId, uploads})

  onProgress('success', 'Done')

  return records
}
