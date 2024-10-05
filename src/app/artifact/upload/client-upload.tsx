import pMap from 'p-suite/p-map'
import {unzip} from 'unzipit'
import {trpcClient} from '~/client/trpc'
import {createProxyClient} from '~/openapi/client'
import {paths} from '~/openapi/generated/supabase-storage'
import {createStorageClient} from '~/storage/supabase'

export const clientUpload = async (artifactId: string, githubToken: string) => {
  const downloadUrl = await trpcClient.getDownloadUrl.query({artifactId})
  console.log('downloadUrl', downloadUrl)

  const response = await fetch(downloadUrl, {
    headers: {authorization: `Bearer ${githubToken}`},
  })
  const {entries} = await unzip(await response.arrayBuffer())
  console.log('entries', Object.keys(entries).join(','))

  const {tokens, supabaseUrl} = await trpcClient.createUploadTokens.mutate({
    artifactId,
    entries: Object.keys(entries),
  })

  const storage = createProxyClient<paths>().configure({
    baseUrl: supabaseUrl,
  })

  const uploads = await pMap(
    tokens,
    async e => {
      console.log('uploading', e.entry)
      await storage.object.upload.sign
        .bucketName('artifact_files')
        .wildcard(e.artifactFullPath)
        .put({
          query: {token: e.token},
          content: {[e.contentType]: await entries[e.entry].blob()},
          acceptStatus: ['2XX', '4XX'],
        })
      console.log('uploaded', e.entry, 'to', e.artifactFullPath)
      return {...e, uploadKey: e.artifactFullPath}
    },
    {concurrency: 10},
  )

  console.log('uploads', uploads)

  const records = await trpcClient.recordUploads.mutate({
    artifactId,
    uploads,
  })

  console.log('records', records)
}
