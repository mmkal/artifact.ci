import {NextRequest, NextResponse} from 'next/server'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as unknown
  console.log('headers', request.headers)
  console.log('event received', request.url, body)
  return NextResponse.json({a: 1})
}

export async function GET(request: NextRequest) {
  console.log('headers', request.headers)
  return NextResponse.json({a: 2})
}
