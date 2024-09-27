import {NextRequest, NextResponse} from 'next/server'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as unknown
  console.log('headers', request.headers)
  console.log('event receveid', body)
  return NextResponse.json({})
}
