import pMap from 'p-suite/p-map'
import {unzip} from 'unzipit'
import {trpcClient} from '~/client/trpc'
import {createProxyClient} from '~/openapi/client'
import {paths} from '~/openapi/generated/supabase-storage'

export async function clientUpload({
  artifactId,
  onProgress = () => {},
}: {
  artifactId: string
  githubToken: string | null | undefined // todo: remove this
  onProgress?: (stage: string, message: string) => void
}) {
  onProgress('start', 'Getting artifact information')
  const downloadUrl = await trpcClient.getDownloadUrl.query({artifactId})
  onProgress('downloading', 'Downloading archive')

  const response = await fetch(downloadUrl, {
    // todo: remove this? hopefully the download url is a signed url? i don't think so though
    // headers: {authorization: `Bearer ${githubToken}`},
  })
  onProgress('extracting', 'Extracting archive')
  const {entries} = await unzip(await response.arrayBuffer())

  onProgress('preparing', 'Getting upload tokens')
  const {tokens: uploads, supabaseUrl} = await trpcClient.createUploadTokens.mutate({
    artifactId,
    entries: Object.keys(entries),
  })
  onProgress('uploading', 'Uploading files')

  const storage = createProxyClient<paths>().configure({
    baseUrl: supabaseUrl,
  })

  onProgress('uploaded_file', `Uploading ${uploads.length} files`)
  await pMap(
    uploads.entries(),
    async ([index, item]) => {
      if (item.token) {
        await storage.object.upload.sign
          .bucketName('artifact_files')
          .wildcard(item.artifactFullPath)
          .put({
            query: {token: item.token},
            content: {[item.contentType]: await entries[item.entry].blob()},
          })
      }
      onProgress('uploaded_file', `Uploaded ${index + 1} of ${uploads.length} ${item.entry.split('/').pop()}`)
    },
    {concurrency: 10},
  )

  onProgress('uploaded_file', `Uploaded ${uploads.length} of ${uploads.length} files`)
  onProgress('saving', 'Saving upload records')

  const records = await trpcClient.recordUploads.mutate({artifactId, uploads})

  onProgress('complete', 'Done')

  return records
}
