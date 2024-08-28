import {upload} from '@vercel/blob/client'
import {readFile} from 'fs/promises'

export const uploadFile = async (params: {filepath: string; prefix: string}) => {
  const url = `${params.prefix}/${params.filepath}`
  console.log({url, params})
  //   const EventTypes = {
  //     generateClientToken: 'blob.generate-client-token',
  //     uploadCompleted: 'blob.upload-completed',
  //   }
  //   const event = {
  //     type: EventTypes.generateClientToken,
  //     payload: {
  //       pathname: params.filepath,
  //       callbackUrl: url,
  //       clientPayload: options.clientPayload,
  //       multipart: options.multipart,
  //     },
  //   }
  //   const res = await fetch(url, {
  //     method: 'POST',
  //     body: JSON.stringify(event),
  //     headers: {
  //       'content-type': 'application/json',
  //     },
  //     signal: options.abortSignal,
  //   })
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
