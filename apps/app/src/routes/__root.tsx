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
      {title: 'artifact.ci app'},
      {
        name: 'description',
        content: 'Signed-in app shell for artifact.ci, including auth, billing, and artifact browser routes.',
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
              <div className="shell__brand">artifact.ci app</div>
              <div className="shell__links">
                <NavLink to="/">Overview</NavLink>
                <NavLink to="/dashboard">Dashboard</NavLink>
                <NavLink to="/account">Account</NavLink>
                <NavLink to="/billing">Billing</NavLink>
                <NavLink to="/settings">Settings</NavLink>
                <NavLink to="/app/artifacts/mmkal/artifact.ci/branch/main/result">Artifacts</NavLink>
                {session.user ? <LogoutButton /> : <NavLink to="/login">Sign In</NavLink>}
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
