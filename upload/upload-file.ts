import {upload} from '@vercel/blob/client'
import * as fs from 'fs/promises'
import {lookup as mimeTypeLookup} from 'mime-types'

export const uploadFile = async (params: {filepath: string; prefix: string}) => {
  // worth considering doing the `fetch`es DIY, it's not doing all that much https://github.com/vercel/storage/blob/main/packages/blob/src/client.ts
  // permalink: https://github.com/vercel/storage/blob/dca9772d45c8403abf7d8fadaea97310666f9b8e/packages/blob/src/client.ts

  console.log('uploading', `${params.prefix}/${params.filepath}`, params, process.env)
  const result = await upload(`${params.prefix}/${params.filepath}`, await fs.readFile(params.filepath), {
    access: 'public',
    handleUploadUrl: '/artifact/upload/signed-url',
    contentType: mimeTypeLookup(params.filepath) || 'text/plain',
    clientPayload: JSON.stringify({githubToken: process.env.GITHUB_TOKEN}),
  })
  console.log({params, result})
}

if (require.main === module) {
  Object.assign(global, {
    window: {location: new URL('https://artifact.ci')},
  })
  console.log({
    filepath: process.env.UPLOAD_FILE_PATH!,
    prefix: process.env.UPLOAD_FILE_PREFIX!,
  })
  void uploadFile({
    filepath: process.env.UPLOAD_FILE_PATH!,
    prefix: process.env.UPLOAD_FILE_PREFIX!,
  })
}
