import mime from 'mime'
import {NextResponse, type NextRequest} from 'next/server'

// http://localhost:3000/artifact/blob/mmkal/expect-type/10622877699/test-report/html/assets/index.html

export async function middleware(request: NextRequest) {
  const artifaceBlobPrefix = '/artifact/blob/'
  if (request.nextUrl.pathname.startsWith(artifaceBlobPrefix)) {
    const storageOrigin = process.env.STORAGE_ORIGIN
    if (!storageOrigin) {
      throw new Error('STORAGE_ORIGIN environment variable is not set')
    }

    const pathname = request.nextUrl.pathname.slice(artifaceBlobPrefix.length)
    const targetUrl = new URL(pathname, storageOrigin)
    const filename = pathname.split('/').pop() || 'file'
    const mimeType = mime.getType(filename) || 'application/octet-stream'

    // todo: get off vercel storage and use our own storage. vercel storage doesn't support inline content: https://vercel.com/docs/storage/vercel-blob#security
    // so we're using a middleware and streaming the response to the client. this will get expensive.
    const storageResponse = await fetch(targetUrl)

    if (!storageResponse.ok) {
      return NextResponse.json({error: 'Failed to fetch blob'}, {status: storageResponse.status})
    }

    const isInline =
      mimeType.startsWith('text/') ||
      mimeType.startsWith('application/html') ||
      mimeType.startsWith('application/javascript') ||
      mimeType.startsWith('application/css') ||
      mimeType.startsWith('image/') ||
      mimeType.startsWith('application/pdf')

    const headers = new Headers(storageResponse.headers)
    headers.set('Content-Type', mimeType)
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none';",
    )
    if (isInline) {
      headers.set('Content-Disposition', `inline; filename="${filename}"`)
    }
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')

    return new NextResponse(storageResponse.body, {
      status: storageResponse.status,
      statusText: storageResponse.statusText,
      headers: headers,
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/artifact/blob/:path*',
}
