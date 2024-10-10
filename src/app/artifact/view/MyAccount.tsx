import Link from 'next/link'
import {Session} from 'next-auth'
import {PathParams, toPath} from './params'

export const MyAccount = ({session, params}: {session: Session | null; params: Partial<PathParams>}) => {
  if (!session) {
    const callbackUrl = toPath(params)
    const searchParams = new URLSearchParams({callbackUrl})
    return (
      <Link
        href={`/api/auth/signin?${searchParams}`}
        className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-md"
      >
        Sign in
      </Link>
    )
  }

  return (
    <Link href="/api/auth/signout" className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-md">
      Sign out
    </Link>
  )
}
