import Link from 'next/link'
import {Session} from 'next-auth'

export const MyAccount = ({session: _session}: {session: Session | null}) => {
  //   if (!session) return null
  return (
    <Link href="/api/auth/signout" className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-md">
      Sign out
    </Link>
  )
}
