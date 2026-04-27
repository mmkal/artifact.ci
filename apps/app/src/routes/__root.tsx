// @ts-nocheck
import {HeadContent, Outlet, Scripts, createRootRouteWithContext} from '@tanstack/react-router'
import type {ReactNode} from 'react'
import {getCurrentSession, type AppSessionSnapshot} from '../auth/session'
import {LogoutButton} from '../ui/logout-button'
import appCssRaw from '../styles.css?raw'
import appCssUrl from '../styles.css?url'

// djb2-ish — we just need something short and stable per file contents.
const hashCss = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

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
    // miniflare serves /src/styles.css with `Cache-Control: max-age=14400`
    // in dev, so previously the CDN + browser happily pinned yesterday's
    // rules. Append a content hash so every CSS edit gets a fresh URL.
    links: [
      {rel: 'stylesheet', href: `${appCssUrl}?v=${hashCss(appCssRaw)}`},
      // moai favicon — data-URI SVG so we don't need a real file.
      // Same trick the old next.js layout used (see git show main:src/app/layout.tsx).
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗿</text></svg>',
      },
    ],
    scripts: [
      // Runtime shim: @tanstack/start-client-core reads
      // process.env.TSS_SERVER_FN_BASE at module load. Vite's `define` is
      // supposed to substitute it at build/transform time, but the plugin
      // excludes these framework packages from optimizeDeps and serves them
      // raw via /@fs/, so the substitution never happens and the browser
      // blows up with "process is not defined". Shimming before any
      // scripts evaluate keeps the client bundle happy.
      {
        children: [
          'globalThis.process = globalThis.process || {env: {}};',
          "globalThis.process.env.TSS_SERVER_FN_BASE = globalThis.process.env.TSS_SERVER_FN_BASE || '/_serverFn/';",
          "globalThis.process.env.TSS_ROUTER_BASEPATH = globalThis.process.env.TSS_ROUTER_BASEPATH || '/';",
          "globalThis.process.env.TSS_SHELL = globalThis.process.env.TSS_SHELL || 'false';",
          "globalThis.process.env.TSS_DEV_SERVER = globalThis.process.env.TSS_DEV_SERVER || 'true';",
          "globalThis.process.env.TSS_DEV_SSR_STYLES_ENABLED = globalThis.process.env.TSS_DEV_SSR_STYLES_ENABLED || 'true';",
          "globalThis.process.env.TSS_DEV_SSR_STYLES_BASEPATH = globalThis.process.env.TSS_DEV_SSR_STYLES_BASEPATH || '/';",
        ].join('\n'),
      },
    ],
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
              <a href="/" className="shell__brand-link">🗿 artifact.ci</a>
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
            <footer className="shell__footer">artifact.ci</footer>
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
