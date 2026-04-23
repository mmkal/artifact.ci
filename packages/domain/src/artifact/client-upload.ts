import {createTRPCClient, httpLink} from '@trpc/client'
import pMap from 'p-suite/p-map'
import {unzip} from 'unzipit'
import {createProxyClient} from '../openapi/client'
import {type paths} from '../openapi/generated/supabase-storage'

type UploadClient = {
  getDownloadUrl: {query(input: {artifactId: string}): Promise<{url: string; githubId: number}>}
  createUploadTokens: {
    mutate(input: {artifactId: string; entries: string[]}): Promise<{
      tokens: Array<{entry: string; artifactFullPath: string; token?: string; contentType: string}>
      supabaseUrl: string
    }>
  }
  storeUploadRecords: {
    mutate(input: {
      artifactId: string
      uploads: Array<{entry: string; artifactFullPath: string; token?: string; contentType: string}>
    }): Promise<{
      entrypoints: {entrypoints: Array<{path: string; shortened: string}>}
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
  const {tokens: uploads, supabaseUrl} = await client.createUploadTokens.mutate({
    artifactId,
    entries: Object.keys(entries),
  })

  onProgress('uploading', 'Uploading files')
  const storage = createProxyClient<paths>().configure({baseUrl: supabaseUrl})

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
      await storage.object.upload.sign.bucketName('artifact_files').wildcard(item.artifactFullPath).put({
        query: {token: item.token},
        content: {[item.contentType]: await entries[item.entry].blob()},
      })
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
