import {NextRequest, NextResponse} from 'next/server'
import {auth} from '../../../../auth'

/** Responds with public info about the signed-in user and logs the full auth object */
export async function GET(_request: NextRequest) {
  const info = await auth()
  console.log('auth info', info)
  return NextResponse.json({user: info?.user, expires: info?.expires})
}
