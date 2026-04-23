// @ts-nocheck
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import type {ReactNode} from 'react'
import {getCurrentSession, type AppSessionSnapshot} from '../auth/session'
import {LogoutButton} from '../ui/logout-button'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{session: AppSessionSnapshot}>()({
  beforeLoad: async () => {
    const session = await getCurrentSession()
    return {session}
  },
  head: () => ({
    meta: [
      {charSet: 'utf-8'},
      {name: 'viewport', content: 'width=device-width, initial-scale=1'},
      {title: 'artifact.ci'},
      {
        name: 'description',
        content: 'View GitHub Actions artifacts in the browser.',
      },
    ],
    links: [{rel: 'stylesheet', href: appCss}],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <Document>
      <Outlet />
    </Document>
  )
}

function Document({children}: {children: ReactNode}) {
  const {session} = Route.useRouteContext()

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="shell">
          <div className="shell__frame">
            <nav className="shell__nav">
              <div className="shell__brand">
                <a href="/" className="shell__brand-link">artifact.ci</a>
              </div>
              <div className="shell__links">
                {session.user ? (
                  <>
                    <NavLink to="/account">
                      {session.user.githubLogin || session.user.email || 'Account'}
                    </NavLink>
                    <LogoutButton />
                  </>
                ) : (
                  <NavLink to="/login">Sign in</NavLink>
                )}
              </div>
            </nav>
            <main className="shell__body">{children}</main>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  )
}

function NavLink({to, children}: {to: string; children: ReactNode}) {
  return (
    <a href={to} className="shell__link">
      {children}
    </a>
  )
}
