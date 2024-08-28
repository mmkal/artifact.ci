/* eslint-disable no-var */
import {upload} from '@vercel/blob/client'
import {readFile} from 'fs/promises'

export const uploadFile = async (params: {filepath: string; prefix: string}) => {
  //   const fileContent = await readFile(params.filepath, 'utf8')
  //   const origin = 'https://artifact-browser.vercel.app'
  //   const url = `${origin}/artifact/upload/signed-url`
  //   console.log({url, params, fileContent})
  //   var event = {
  //     type: 'blob.generate-client-token',
  //     payload: {
  //       pathname: 'prefix/blah/foo.txt',
  //       callbackUrl: 'https://artifact-browser.vercel.app/api/artifact/upload/signed-url', // used when upload is complete
  //       clientPayload: null,
  //       multipart: false,
  //     },
  //   }
  //   var res = await fetch(url, {
  //     method: 'POST',
  //     body: JSON.stringify(event),
  //     headers: {
  //       'content-type': 'application/json',
  //     },
  //   })
  //   console.log(
  //     url,
  //     res.status,
  //     res.statusText,
  //     Object.fromEntries(res.headers),
  //     {
  //       data: await res
  //         .text()
  //         .then(text => JSON.parse(text) as {})
  //         .catch(String),
  //     },
  //     // JSON.stringify({text: await res.text()}),
  //   )
  //   if (!res.ok) {
  //     throw new Error(`Request to ${url} failed with status ${res.status}`)
  //   }

  const result = await upload(`${params.prefix}/${params.filepath}`, await readFile(params.filepath), {
    access: 'public',
    handleUploadUrl: '/artifact/upload/signed-url',
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
