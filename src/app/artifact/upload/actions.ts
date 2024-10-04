'use server'

import {NextResponse} from 'next/server'

export async function startArtifactProcessing(prevState: any, formData: FormData) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "download", "progress": 0}\n\n'))
      await new Promise(resolve => setTimeout(resolve, 1000))
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "download", "progress": 100}\n\n'))

      await new Promise(resolve => setTimeout(resolve, 500))
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "extract", "progress": 0}\n\n'))
      await new Promise(resolve => setTimeout(resolve, 1000))
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "extract", "progress": 100}\n\n'))

      await new Promise(resolve => setTimeout(resolve, 500))
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "upload", "progress": 0}\n\n'))
      await new Promise(resolve => setTimeout(resolve, 1000))
      controller.enqueue(encoder.encode('event: message\ndata: {"stage": "upload", "progress": 100}\n\n'))

      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
