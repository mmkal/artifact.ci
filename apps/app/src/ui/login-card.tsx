'use client'

import {authClient} from '../auth/auth-client'

export function LoginCard({callbackUrl}: {callbackUrl?: string}) {
  return (
    <div className="meta">
      <div className="badge">GitHub OAuth via Better Auth</div>
      <p>
        Sign in with GitHub to manage your account and unlock artifact access. Cookies stay first-party on the
        `artifact.ci` origin.
      </p>
      <div>
        <button
          type="button"
          className="shell__link shell__link--active"
          onClick={async () => {
            await authClient.signIn.social({
              provider: 'github',
              callbackURL: callbackUrl || '/dashboard',
            })
          }}
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  )
}
