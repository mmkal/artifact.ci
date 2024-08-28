import {upload} from '@vercel/blob/client'
import {readFile} from 'fs/promises'

export const uploadFile = async (params: {filepath: string; prefix: string}) => {
  const result = await upload(`${params.prefix}/${params.filepath}`, await readFile(params.filepath), {
    access: 'public',
    handleUploadUrl: '/api/artifact/upload/signed-url',
  })

  console.log({result})
}

if (require.main === module) {
  console.log({
    filepath: process.env.UPLOAD_FILE_PATH!,
    prefix: process.env.UPLOAD_FILE_PREFIX!,
  })
  void uploadFile({
    filepath: process.env.UPLOAD_FILE_PATH!,
    prefix: process.env.UPLOAD_FILE_PREFIX!,
  })
}
