'use client'

import {authClient} from '../auth/auth-client'

export function LoginCard({callbackUrl}: {callbackUrl?: string}) {
  return (
    <div>
      <button
        type="button"
        className="shell__link shell__link--active"
        onClick={async () => {
          await authClient.signIn.social({
            provider: 'github',
            callbackURL: callbackUrl || '/',
          })
        }}
      >
        Sign in with GitHub
      </button>
    </div>
  )
}
