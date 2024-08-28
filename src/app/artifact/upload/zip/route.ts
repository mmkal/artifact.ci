import {put} from '@vercel/blob'
import {NextRequest, NextResponse} from 'next/server'
import {getGithubAccessToken} from '../../../../auth'

export async function POST(request: NextRequest) {
  try {
    const token = await getGithubAccessToken(request)
    if (!token) {
      return NextResponse.json({error: 'Unauthorized'}, {status: 401})
    }

    // Check if the request contains a file
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({error: 'No file provided'}, {status: 400})
    }

    // Check if the file is a ZIP
    if (file.type !== 'application/zip') {
      return NextResponse.json({error: 'File must be a ZIP archive'}, {status: 400})
    }

    // Upload the file to Vercel Blob
    const blob = await put(file.name, file, {
      access: 'public',
    })

    // Return the URL of the uploaded file
    return NextResponse.json({url: blob.url}, {status: 200})
  } catch (error) {
    console.error('Error uploading file:', error)
    return NextResponse.json({error: 'Internal server error'}, {status: 500})
  }
}
