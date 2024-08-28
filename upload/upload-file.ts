import {upload} from '@vercel/blob/client'
import {readFile} from 'fs/promises'

export const uploadFile = async (params: {filepath: string; prefix: string}) => {
  const url = `${params.prefix}/${params.filepath}`
  console.log({url, params})
  const event = {
    type: 'blob.generate-client-token',
    payload: {
      pathname: 'https://artifact-browser.vercel.app/prefix/blah/foo.txt',
      callbackUrl: 'https://artifact-browser.vercel.app/api/artifact/upload/signed-url',
      clientPayload: null,
      multipart: false,
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(event),
    headers: {
      'content-type': 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}: ${await res.text()}`)
  }

  const result = await upload(`${params.prefix}/${params.filepath}`, await readFile(params.filepath), {
    access: 'public',
    handleUploadUrl: '/api/artifact/upload/signed-url',
  })

  console.log({params, result})
}

if (require.main === module) {
  Object.assign(global, {
    window: {location: new URL('https://artifact-browser.vercel.app')},
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
