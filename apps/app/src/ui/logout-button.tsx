'use client'

import {authClient} from '../auth/auth-client'

export function LogoutButton() {
  return (
    <button
      type="button"
      className="shell__link"
      onClick={async () => {
        await authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              window.location.href = '/login'
            },
          },
        })
      }}
    >
      Sign Out
    </button>
  )
}
